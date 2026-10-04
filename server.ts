import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

// High body limit for base64 media uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer memory storage for RH binary upload API proxying
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max limit
});

// In-Memory hosted media store to guarantee public accessible URLs for user-uploaded media
interface HostedMediaItem {
  id: string;
  buffer: Buffer;
  mimeType: string;
  filename: string;
  createdAt: number;
}
const hostedMediaStore = new Map<string, HostedMediaItem>();

// Clean old files after 3 hours
setInterval(() => {
  const cutoff = Date.now() - 3 * 60 * 60 * 1000;
  for (const [id, item] of hostedMediaStore.entries()) {
    if (item.createdAt < cutoff) {
      hostedMediaStore.delete(id);
    }
  }
}, 15 * 60 * 1000);

// Endpoint to serve locally hosted media directly to RunningHub or browser
app.get('/api/media/hosted/:fileId', (req, res) => {
  const item = hostedMediaStore.get(req.params.fileId);
  if (!item) {
    return res.status(404).send('Media file not found or expired.');
  }
  res.setHeader('Content-Type', item.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${item.filename}"`);
  return res.send(item.buffer);
});

// RunningHub API Key Pool State & Types
export interface ApiKeyPoolItem {
  id: string;
  key: string;
  status: 'enterprise' | 'non_enterprise' | 'invalid' | 'unverified';
  statusLabel: string;
  addedAt: string;
  remainCoins?: number;
  lastUsedAt?: string;
  lastError?: string;
}

let apiKeyPool: ApiKeyPoolItem[] = [];
let autoRotateEnabled = true;
let motionV2Enabled = true;
let wanEnabled = true;

// --- GENERATION TASK MONITORING SYSTEM ---
interface GenerationTask {
  id: string; // RunningHub Task ID
  telegramUserId: number;
  userName: string;
  model: string;
  workflowId: string;
  apiKeyId: string; // Masked key
  startTime: number;
  endTime?: number;
  status: 'QUEUED' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
  errorMessage?: string;
  resultUrl?: string;
  duration?: number; // in seconds
}

let generationTasks: GenerationTask[] = [];
const MAX_TASK_LOGS = 150;
const TASKS_HISTORY_FILE = path.join(process.cwd(), 'tasks_history.json');

function loadTasksHistory() {
  try {
    if (fs.existsSync(TASKS_HISTORY_FILE)) {
      const raw = fs.readFileSync(TASKS_HISTORY_FILE, 'utf-8');
      if (!raw || !raw.trim()) {
        console.log('[Tasks History] File is empty, starting with fresh history.');
        return;
      }
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        generationTasks = data;
        console.log(`[Tasks History] Loaded ${generationTasks.length} recorded tasks from file.`);
      }
    }
  } catch (err: any) {
    console.error('[Tasks History] Load error:', err.message);
  }
}

function saveTasksHistory() {
  try {
    fs.writeFileSync(TASKS_HISTORY_FILE, JSON.stringify(generationTasks.slice(0, MAX_TASK_LOGS), null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[Tasks History] Save error:', err.message);
  }
}

loadTasksHistory();

function recordTask(task: Partial<GenerationTask> & { id: string }) {
  const index = generationTasks.findIndex(t => t.id === task.id);
  if (index !== -1) {
    generationTasks[index] = { ...generationTasks[index], ...task } as GenerationTask;
  } else {
    generationTasks.unshift(task as GenerationTask);
    if (generationTasks.length > MAX_TASK_LOGS) {
      generationTasks.pop();
    }
  }
  saveTasksHistory();
}

// Rich Telegram History Viewer for both Member & Admin
function formatHistoryViewTelegram(chatId: number, isAdmin: boolean) {
  const activeJobs = getMemberActiveJobs(chatId);
  const statusBadge = formatMemberActiveStatusBadge(chatId, isAdmin);
  
  // Filter user's tasks; if admin, also include tasks where telegramUserId matches or top recent tasks
  const userTasks = generationTasks
    .filter(t => t.telegramUserId === chatId || (isAdmin && (!t.telegramUserId || t.telegramUserId === SOLE_ADMIN_ID)))
    .slice(0, 10);
  
  const completedTasks = userTasks.filter(t => t.status === 'SUCCESS' && t.resultUrl);
  const otherTasks = userTasks.filter(t => t.status !== 'SUCCESS');

  let historyText = `📋 *RIWAYAT GENERATE VIDEO*${statusBadge ? `\n\n${statusBadge}` : ''}\n`;

  // 1. Active Running Jobs
  if (activeJobs.length > 0) {
    historyText += `\n🔄 *PROSES BERJALAN SAAT INI:*`;
    activeJobs.forEach((job, idx) => {
      const elapsed = Math.floor((Date.now() - job.startedAt) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      const modelName = job.model === 'motion-v2' ? '🚀 Motion V2' : '✨ Wan 2.1';
      historyText += `\n\n${idx + 1}. *${modelName}* • \`${job.status}\` (⏱️ \`${timeStr}\`)\n   └ Task ID: \`${job.taskId || 'Menghubungkan...'}\``;
    });
    historyText += '\n';
  }

  // 2. Completed Videos with Full Details & Download Links
  if (completedTasks.length > 0) {
    historyText += `\n🎬 *HASIL VIDEO YANG SUDAH JADI:*`;
    completedTasks.forEach((t, idx) => {
      const modelCfg = getMotionModelConfig(t.model);
      const modelName = modelCfg.name || (t.model === 'motion-v2' ? 'Motion V2 — 1080HD' : 'Wan 2.1 V5');
      const dateStr = t.endTime
        ? new Date(t.endTime).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
        : 'Baru saja';
      const durationStr = t.duration ? `${Math.floor(t.duration / 60)}m ${t.duration % 60}s` : 'Selesai';
      
      historyText += `\n\n${idx + 1}. *${modelName}* ✅
• ⏱️ Render: ${durationStr} (${dateStr})
• 🆔 Task: \`${t.id}\`
• ⬇️ *Link Video:* [Download Video](${t.resultUrl})`;
    });
  }

  // 3. Failed or Pending Tasks
  if (otherTasks.length > 0) {
    historyText += `\n\n⚠️ *Tugas Lainnya:*`;
    otherTasks.slice(0, 3).forEach((t) => {
      const modelName = t.model === 'motion-v2' ? 'Motion V2' : 'Wan 2.1';
      historyText += `\n• ❌ *${modelName}* (\`${t.id.slice(-8)}\`): ${t.errorMessage || 'Gagal'}`;
    });
  }

  // 4. Empty State
  if (activeJobs.length === 0 && userTasks.length === 0) {
    historyText += `\n_Belum ada riwayat generate video._\n_Setiap video yang kamu buat akan otomatis tercatat dan siap diunduh di sini! 🚀_`;
  }

  const buttons: any[][] = [
    [
      { text: '🔄 Refresh Riwayat', callback_data: 'HISTORY' },
    ],
    [
      { text: '🚀 Generate Motion V2', callback_data: 'SET_MODEL_MOTION_V2' },
      { text: '✨ Generate Wan 2.1', callback_data: 'SET_MODEL_WAN' },
    ],
    [
      { text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' },
    ],
  ];

  return { text: historyText, keyboard: buttons };
}

function getMaskedKey(key: string): string {
  if (!key) return 'N/A';
  if (key.length <= 4) return key;
  return `••••${key.slice(-4)}`;
}

// --- PARALLEL GENERATION CONCURRENCY CONTROL (MAX 2 ACTIVE PER MEMBER) ---
export interface ActiveMemberJob {
  jobId: string;       // Unique tracking instance ID
  chatId: number;      // Member identifier
  userName?: string;   // Member name
  model: string;       // Model used
  startedAt: number;   // Timestamp
  status: 'QUEUED' | 'RUNNING' | 'PROCESSING';
  taskId?: string;     // RunningHub Task ID once available
}

// In-memory mapping of active generation jobs: chatId -> Map<jobId, ActiveMemberJob>
const activeJobsByMember: Map<number, Map<string, ActiveMemberJob>> = new Map();

export const PARALLEL_LIMIT_REJECTION_TEXT = `⏳ *BATAS PROSES TERCAPAI*

Kamu sedang memiliki 2 proses generate yang sedang berjalan.

🟠 *Proses aktif:* 2/2

Silakan tunggu salah satu proses selesai sebelum membuat generate baru.`;

// Helper to get active jobs for a specific member
export function getMemberActiveJobs(chatId: number): ActiveMemberJob[] {
  const memberMap = activeJobsByMember.get(chatId);
  if (!memberMap) return [];
  return Array.from(memberMap.values());
}

// Helper to count active jobs for a specific member
export function getMemberActiveCount(chatId: number): number {
  const memberMap = activeJobsByMember.get(chatId);
  if (!memberMap) return 0;
  return memberMap.size;
}

// Atomic slot acquisition: allows max 2 active jobs for regular members, unlimited for admins
export function acquireJobSlot(
  chatId: number,
  jobId: string,
  model: string,
  isAdmin: boolean,
  userName?: string
): { success: boolean; activeCount: number; maxAllowed: number } {
  const currentCount = getMemberActiveCount(chatId);

  // Strictly enforce limit of 2 active parallel jobs for non-admin members
  if (!isAdmin && currentCount >= 2) {
    return { success: false, activeCount: currentCount, maxAllowed: 2 };
  }

  let memberMap = activeJobsByMember.get(chatId);
  if (!memberMap) {
    memberMap = new Map();
    activeJobsByMember.set(chatId, memberMap);
  }

  memberMap.set(jobId, {
    jobId,
    chatId,
    userName,
    model,
    startedAt: Date.now(),
    status: 'QUEUED',
  });

  return { success: true, activeCount: memberMap.size, maxAllowed: isAdmin ? Infinity : 2 };
}

// Slot release: immediately called when a job finishes (COMPLETED, FAILED, CANCELLED, or EXPIRED)
export function releaseJobSlot(chatId: number, jobId: string) {
  const memberMap = activeJobsByMember.get(chatId);
  if (memberMap) {
    memberMap.delete(jobId);
    if (memberMap.size === 0) {
      activeJobsByMember.delete(chatId);
    }
  }
}

// Update status of active job (e.g. QUEUED -> RUNNING -> PROCESSING)
export function updateJobSlotStatus(
  chatId: number,
  jobId: string,
  status: 'QUEUED' | 'RUNNING' | 'PROCESSING',
  taskId?: string
) {
  const memberMap = activeJobsByMember.get(chatId);
  if (memberMap) {
    const job = memberMap.get(jobId);
    if (job) {
      job.status = status;
      if (taskId) job.taskId = taskId;
    }
  }
}

// Visual status badge for Telegram Bot & Web UI
export function formatMemberActiveStatusBadge(chatId: number, isAdmin: boolean): string {
  if (isAdmin) {
    return '';
  }
  const count = getMemberActiveCount(chatId);
  if (count === 0) {
    return `🎬 *GENERATE*\n🟢 *Aktif:* 0/2`;
  } else if (count === 1) {
    return `🎬 *GENERATE*\n🟠 *Aktif:* 1/2`;
  } else {
    return `🎬 *GENERATE*\n🔴 *Aktif:* 2/2`;
  }
}
// ------------------------------------------

// Master Default Motion Control Prompt (Real-world high-fidelity identity & motion preservation)
export const DEFAULT_REALISTIC_PROMPT =
  'Create a high-quality motion control video using the provided Reference Image and Reference Video. Preserve the person from the Reference Image with maximum identity consistency throughout the video. Keep the same face, facial features, hairstyle, skin tone, body proportions, clothing, and overall appearance. Do not beautify, replace, stylize, or alter the face. Recreate the Reference Video as accurately as possible by matching body movements, facial expressions, head movements, eye direction, hand gestures, poses, timing, speed, rhythm, camera movement, framing, and perspective. Do not add extra movements, expressions, or camera changes. Maintain realistic motion, natural physics, smooth interpolation, high visual quality, and strong temporal consistency. Avoid flickering, morphing, warping, face distortion, and quality loss. Use only the original audio from the Reference Video. Do not add, replace, or modify audio. Match the duration of the Reference Video as closely as the model allows. Generate the output in a 9:16 aspect ratio. Prioritize identity preservation, accurate motion transfer, facial consistency, realistic cinematic quality, and motion control.';

export const DEFAULT_REALISTIC_NEGATIVE_PROMPT =
  'deformed face, face morphing, face distortion, face replacement, unnatural facial features, warped face, extra limbs, missing limbs, flickering, jitter, jittery movement, low quality, artifacts, blurry, bad anatomy, bad eyes, disfigured, cartoonish, oversaturated, stylized alteration';

// Embedded Motion Models Registry - Each model contains its OWN dedicated Workflow ID, Foto Node ID, and Video Node ID
export interface MotionModelDefinition {
  id: 'wan-2.1' | 'motion-v2';
  name: string;
  tag: string;
  vendor: string;
  workflowId: string;
  imageNodeId: string;
  videoNodeId: string;
  description: string;
  specs: string[];
  extraNodes?: Array<{ nodeId: string; fieldName: string; fieldValue: any }>;
}

export const EMBEDDED_MOTION_MODELS: Record<string, MotionModelDefinition> = {
  'motion-v2': {
    id: 'motion-v2',
    name: 'Motion V2 — 1080HD',
    tag: '🚀 Motion V2',
    vendor: 'RunningHub (Motion Control V2 1080HD)',
    workflowId: '2083908699113918465',
    imageNodeId: '30',
    videoNodeId: '33',
    description: 'Motion Control Output 1080HD (RunningHub WebApp ID 2083908699113918465)',
    specs: [
      'Model Name: Motion Control Output 1080HD',
      'WebApp ID: 2083908699113918465',
      '🖼️ Node Foto ID: 30 (LoadImage)',
      '🎥 Node Video ID: 33 (VHS_LoadVideo)',
      '💎 Resolusi: 1080p Full HD (1080HD Output)',
      'High-precision character pose & motion transfer V2',
      'Enhanced 1080HD visual sharpness & lipsync',
    ],
    extraNodes: [],
  },
  'wan-2.1': {
    id: 'wan-2.1',
    name: 'Wan 2.1 Animate V5 (Motion Transfer HD)',
    tag: '✨ Wan 2.1 V5',
    vendor: 'RunningHub (Wan2.1 / Alibaba)',
    workflowId: '2001911147597033473',
    imageNodeId: '17',
    videoNodeId: '102',
    description: 'Wan 2.1 Animate V5 (Video-to-Video Motion Transfer HD)',
    specs: [
      'Model Name: Wan 2.1 Animate V5 (Motion Transfer HD)',
      'WebApp ID: 2001911147597033473',
      '🖼️ Node Foto ID: 17 (LoadImage)',
      '🎥 Node Video ID: 102 (VHS_LoadVideo)',
      '✍️ Node Prompt ID: 709 (CR Text)',
      '💎 Durasi: Hingga 49 detik / 1500 Frame Video',
      'Superior character pose & garment dynamics',
      'Sinkronisasi audio asli & retargeting gerakan',
    ],
    extraNodes: [
      { nodeId: '709', fieldName: 'text', fieldValue: DEFAULT_REALISTIC_PROMPT },
    ],
  },
};

export function getMotionModelConfig(modelId: string = 'motion-v2'): MotionModelDefinition {
  return EMBEDDED_MOTION_MODELS[modelId] || EMBEDDED_MOTION_MODELS['motion-v2'] || EMBEDDED_MOTION_MODELS['wan-2.1'];
}

export function formatModelDetailsTelegram(modelId: string = 'motion-v2'): string {
  const cfg = getMotionModelConfig(modelId);
  return `📌 *Workflow ID:* \`${cfg.workflowId}\`\n🖼️ *Node Foto:* \`${cfg.imageNodeId}\` | 🎥 *Node Video:* \`${cfg.videoNodeId}\``;
}

// Active RunningHub Workflow Configuration for NORMAL API keys
let activeWorkflowId = process.env.RUNNINGHUB_WORKFLOW_ID || '2083908699113918465';
let imageNodeId = '30';
let videoNodeId = '102';

const KEYS_POOL_FILE = path.join(process.cwd(), 'keys_pool.json');
const BOT_CONFIG_FILE = path.join(process.cwd(), 'bot_config.json');
const BOT_USERS_FILE = path.join(process.cwd(), 'bot_users.json');

// Telegram User Management & Access Control Schema
export interface TelegramBotUser {
  id: number;
  chatId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  role: 'admin' | 'user';
  status: 'active' | 'pending' | 'blocked';
  requestedAt: string;
  registeredAt?: string;
  approvedAt?: string;
  approvedBy?: number;
  rejectedAt?: string;
  blockedAt?: string;
  lastActiveAt?: string;
  generatedCount: number;
}

export interface PermanentBlacklistEntry {
  id: number;
  name?: string;
  username?: string;
  reason?: string;
  blacklistedAt: string;
}

export const SOLE_ADMIN_ID = 8781652064;

// 🔒 KUNCI PENGAMAN KHUSUS SUPER ADMIN
export const MASTER_SECURITY_KEY = '03042003';
export const MASTER_SECURITY_KEY_ALT = '3april2003';

let botUsers: TelegramBotUser[] = [];
let adminUserIds: number[] = [SOLE_ADMIN_ID];

function saveTelegramUsers() {
  try {
    fs.writeFileSync(
      BOT_USERS_FILE,
      JSON.stringify({ adminUserIds: [SOLE_ADMIN_ID], users: botUsers }, null, 2),
      'utf-8'
    );
  } catch (err: any) {
    console.error('[Bot Users] Save error:', err.message);
  }
}

function loadTelegramUsers() {
  try {
    if (fs.existsSync(BOT_USERS_FILE)) {
      const raw = fs.readFileSync(BOT_USERS_FILE, 'utf-8');
      if (!raw || !raw.trim()) {
        console.log('[Bot Users] File is empty, starting with fresh users list.');
        return;
      }
      const data = JSON.parse(raw);
      adminUserIds = [SOLE_ADMIN_ID];
      if (data && Array.isArray(data.users)) {
        botUsers = data.users.map((u: any) => ({
          ...u,
          role: u.id === SOLE_ADMIN_ID ? 'admin' : 'user',
          status: u.status,
        }));
      }
      console.log(`[Bot Users] Loaded ${botUsers.length} users (Sole Admin: ${SOLE_ADMIN_ID})`);
    }
  } catch (err: any) {
    console.error('[Bot Users] Load error:', err.message);
  }
}

loadTelegramUsers();

function saveBotConfig() {
  try {
    fs.writeFileSync(
      BOT_CONFIG_FILE,
      JSON.stringify({ activeWorkflowId, imageNodeId, videoNodeId, autoRotateEnabled, adminUserIds, motionV2Enabled, wanEnabled }, null, 2),
      'utf-8'
    );
    console.log(`[Bot Config] Saved config (Workflow ID: ${activeWorkflowId})`);
  } catch (err: any) {
    console.error('[Bot Config] Save error:', err.message);
  }
}

function loadBotConfig() {
  try {
    if (fs.existsSync(BOT_CONFIG_FILE)) {
      const raw = fs.readFileSync(BOT_CONFIG_FILE, 'utf-8');
      if (!raw || !raw.trim()) {
        console.log('[Bot Config] Config file is empty, using system defaults.');
        return;
      }
      const data = JSON.parse(raw);
      if (data) {
        if (data.activeWorkflowId) activeWorkflowId = data.activeWorkflowId;
        if (data.imageNodeId) imageNodeId = data.imageNodeId;
        if (data.videoNodeId) videoNodeId = data.videoNodeId;
        if (typeof data.autoRotateEnabled === 'boolean') autoRotateEnabled = data.autoRotateEnabled;
        if (typeof data.motionV2Enabled === 'boolean') motionV2Enabled = data.motionV2Enabled;
        if (typeof data.wanEnabled === 'boolean') wanEnabled = data.wanEnabled;
      }
      console.log(`[Bot Config] Loaded config from file (Workflow ID: ${activeWorkflowId})`);
    }
  } catch (err: any) {
    console.error('[Bot Config] Load error:', err.message);
  }
}

loadBotConfig();

// ⏳ FITUR AUTO-DELETE VIDEO 2 HARI (48 JAM)
export interface AutoDeleteEntry {
  id: string;
  chatId: number;
  messageId: number;
  deleteAt: number; // Timestamp ms saat pesan harus terhapus (2 hari = 48 jam)
  createdAt: string;
  modelLabel?: string;
  taskId?: string;
}

const AUTO_DELETE_FILE = path.join(process.cwd(), 'auto-delete-schedule.json');
let autoDeleteQueue: AutoDeleteEntry[] = [];

function loadAutoDeleteQueue() {
  try {
    if (fs.existsSync(AUTO_DELETE_FILE)) {
      const raw = fs.readFileSync(AUTO_DELETE_FILE, 'utf-8');
      if (!raw || !raw.trim()) {
        console.log('[AutoDelete] Queue file is empty, starting fresh.');
        return;
      }
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        autoDeleteQueue = data;
      }
      console.log(`[AutoDelete] Loaded ${autoDeleteQueue.length} scheduled video deletions from file.`);
    }
  } catch (err: any) {
    console.error('[AutoDelete] Load error:', err.message);
  }
}

function saveAutoDeleteQueue() {
  try {
    fs.writeFileSync(AUTO_DELETE_FILE, JSON.stringify(autoDeleteQueue, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[AutoDelete] Save error:', err.message);
  }
}

function scheduleAutoDeleteVideo(chatId: number, messageId: number, modelLabel?: string, taskId?: string) {
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000; // 48 jam
  const deleteAt = Date.now() + TWO_DAYS_MS;
  const entry: AutoDeleteEntry = {
    id: `del_${Date.now()}_${messageId}`,
    chatId,
    messageId,
    deleteAt,
    createdAt: new Date().toISOString(),
    modelLabel,
    taskId,
  };
  autoDeleteQueue.push(entry);
  saveAutoDeleteQueue();
  console.log(`[AutoDelete] ⏳ Scheduled video message ${messageId} in chat ${chatId} to auto-delete in 2 days (${new Date(deleteAt).toISOString()})`);
}

async function processExpiredAutoDeletes() {
  if (autoDeleteQueue.length === 0) return;
  const now = Date.now();
  const expired = autoDeleteQueue.filter((item) => now >= item.deleteAt);
  if (expired.length === 0) return;

  console.log(`[AutoDelete] Processing ${expired.length} expired video message deletions (2 days threshold reached)...`);

  for (const item of expired) {
    try {
      const res = await sendTelegramApi('deleteMessage', {
        chat_id: item.chatId,
        message_id: item.messageId,
      });
      if (res && res.ok) {
        console.log(`[AutoDelete] 🗑️ Successfully auto-deleted video message ${item.messageId} in chat ${item.chatId} (Task: ${item.taskId || 'N/A'})`);
      } else {
        console.warn(`[AutoDelete] Could not delete message ${item.messageId} in chat ${item.chatId}: ${res?.description}`);
      }

      // Also clean up local video file from disk if present
      if (item.taskId) {
        const localCachedFile = path.join(VIDEO_STORAGE_DIR, `motion_control_${item.taskId}.mp4`);
        if (fs.existsSync(localCachedFile)) {
          try { fs.unlinkSync(localCachedFile); } catch (e) {}
        }
      }
    } catch (err: any) {
      console.error(`[AutoDelete] Error deleting message ${item.messageId}:`, err.message);
    }
    // Remove processed entry from queue
    autoDeleteQueue = autoDeleteQueue.filter((q) => q.id !== item.id);
  }
  saveAutoDeleteQueue();
}

loadAutoDeleteQueue();
setInterval(processExpiredAutoDeletes, 30000);

// Helper to mask API key for privacy
function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••' + key.slice(-4);
  return '••••••••' + key.slice(-4);
}

// Get status label badge
function getStatusLabel(status: ApiKeyPoolItem['status']): string {
  switch (status) {
    case 'enterprise':
      return '🟢 Aktif — siap';
    case 'non_enterprise':
      return '🟡 0 Saldo RH Coins';
    case 'invalid':
      return '🔴 Invalid / Unauthorized';
    case 'unverified':
    default:
      return '🟡 Belum diverifikasi';
  }
}

const DELETED_KEYS_FILE = path.join(process.cwd(), 'deleted_keys.json');
let deletedKeysList: string[] = [];

function loadDeletedKeys() {
  try {
    if (fs.existsSync(DELETED_KEYS_FILE)) {
      const raw = fs.readFileSync(DELETED_KEYS_FILE, 'utf-8');
      if (!raw || !raw.trim()) {
        console.log('[Deleted Keys] File is empty.');
        return;
      }
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        deletedKeysList = data.map((k: any) => (typeof k === 'string' ? k.trim() : '')).filter(Boolean);
      }
    }
  } catch (err: any) {
    console.error('[Deleted Keys] Load error:', err.message);
  }
}

function saveDeletedKeys() {
  try {
    fs.writeFileSync(DELETED_KEYS_FILE, JSON.stringify(Array.from(new Set(deletedKeysList)), null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[Deleted Keys] Save error:', err.message);
  }
}

loadDeletedKeys();

// Save API keys to persistent JSON file
function saveApiKeyPoolToFile() {
  try {
    const keysToSave = apiKeyPool.map((k) => k.key);
    fs.writeFileSync(KEYS_POOL_FILE, JSON.stringify(keysToSave, null, 2), 'utf-8');
    console.log(`[Key Pool] Saved ${keysToSave.length} keys to ${KEYS_POOL_FILE}`);
  } catch (err: any) {
    console.error('[Key Pool] Failed to save keys to file:', err.message);
  }
}

// Load API keys from persistent JSON file
function loadApiKeyPoolFromFile() {
  try {
    if (fs.existsSync(KEYS_POOL_FILE)) {
      const raw = fs.readFileSync(KEYS_POOL_FILE, 'utf-8');
      if (!raw || !raw.trim()) {
        console.log('[Key Pool] Key pool file is empty.');
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((k: any) => {
          const keyStr = typeof k === 'string' ? k.trim() : k?.key?.trim();
          if (keyStr && keyStr.length >= 8 && !deletedKeysList.includes(keyStr) && !apiKeyPool.some((item) => item.key === keyStr)) {
            apiKeyPool.push({
              id: `key-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              key: keyStr,
              status: 'unverified',
              statusLabel: getStatusLabel('unverified'),
              addedAt: new Date().toISOString(),
            });
          }
        });
        console.log(`[Key Pool] Loaded ${apiKeyPool.length} keys from ${KEYS_POOL_FILE}`);
      }
    }
  } catch (err: any) {
    console.error('[Key Pool] Failed to load keys from file:', err.message);
  }
}

// Initialize pool from file
loadApiKeyPoolFromFile();

export function addApiKeyToPool(keyStr: string): boolean {
  const clean = keyStr.trim();
  if (clean.length < 8) return false;
  
  // Un-blacklist if previously deleted
  if (deletedKeysList.includes(clean)) {
    deletedKeysList = deletedKeysList.filter((k) => k !== clean);
    saveDeletedKeys();
  }

  if (apiKeyPool.some((k) => k.key === clean)) return false;
  const newItem: ApiKeyPoolItem = {
    id: `key-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    key: clean,
    status: 'unverified',
    statusLabel: getStatusLabel('unverified'),
    addedAt: new Date().toISOString(),
  };
  apiKeyPool.unshift(newItem);
  saveApiKeyPoolToFile();
  // Trigger background verification
  verifyApiKeyItem(newItem).then(() => {
    saveApiKeyPoolToFile();
  });
  return true;
}

export function removeApiKeyFromPool(keyStr: string): boolean {
  const clean = keyStr.trim();
  const initialLen = apiKeyPool.length;
  const removedItems = apiKeyPool.filter((k) => k.key === clean || k.id === clean);
  apiKeyPool = apiKeyPool.filter((k) => k.key !== clean && k.id !== clean);
  if (apiKeyPool.length < initialLen) {
    removedItems.forEach((item) => {
      if (item.key && !deletedKeysList.includes(item.key)) {
        deletedKeysList.push(item.key);
      }
    });
    saveDeletedKeys();
    saveApiKeyPoolToFile();
    return true;
  }
  return false;
}

// Check account balance & coins via RunningHub OpenAPI
async function checkAccountStatus(apiKey: string): Promise<{ remainCoins: number; apiType?: string; error?: string }> {
  try {
    const res = await fetch('https://www.runninghub.ai/uc/openapi/accountStatus', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'apikey': apiKey,
      },
      body: JSON.stringify({ apiKey }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.code === 0 && data.data) {
      const coins = Number(data.data.remainCoins || 0);
      return { remainCoins: coins, apiType: data.data.apiType };
    }
    return { remainCoins: 0, error: data?.msg || data?.errorMessage || 'Failed to fetch account status' };
  } catch (e: any) {
    return { remainCoins: 0, error: e.message };
  }
}

// Helper to test if a key has access on RunningHub Model API
async function verifyApiKeyItem(item: ApiKeyPoolItem): Promise<ApiKeyPoolItem> {
  try {
    const statusResult = await checkAccountStatus(item.key);
    item.remainCoins = statusResult.remainCoins;
    if (statusResult.remainCoins > 0) {
      item.status = 'enterprise'; // Treated as active key ready for generation
      if (statusResult.apiType === 'ENTERPRISE' || statusResult.apiType === 'ENTERPRISE_SHARED') {
        item.statusLabel = `🟢 Enterprise (${statusResult.remainCoins} RH Coins)`;
      } else {
        item.statusLabel = `🟢 Aktif (${statusResult.remainCoins} RH Coins)`;
      }
      item.lastError = undefined;
    } else if (statusResult.error) {
      item.status = 'invalid';
      item.statusLabel = '🔴 Invalid Key / Error';
      item.lastError = statusResult.error;
    } else {
      item.status = 'non_enterprise';
      item.statusLabel = '🟡 0 RH Coins';
      item.lastError = 'Account status returned 0 RH Coins';
    }
  } catch (err: any) {
    item.lastError = err.message;
  }
  return item;
}

// Async initial background verification for all loaded keys
setTimeout(async () => {
  if (apiKeyPool.length > 0) {
    console.log(`[Key Pool] Running background verification for ${apiKeyPool.length} keys...`);
    for (const item of apiKeyPool) {
      if (item.status === 'unverified') {
        await verifyApiKeyItem(item);
      }
    }
    console.log(`[Key Pool] Background verification completed.`);
  }
}, 1000);

// Get ordered candidates for generation (sorted by highest RH Coins balance first)
function getCandidateKeys(userApiKey?: string): ApiKeyPoolItem[] {
  const candidates: ApiKeyPoolItem[] = [];

  // Add user explicit key if given
  if (userApiKey && userApiKey.trim()) {
    const existing = apiKeyPool.find((k) => k.key === userApiKey.trim());
    if (existing) {
      candidates.push(existing);
    } else {
      candidates.push({
        id: `user-key-${Date.now()}`,
        key: userApiKey.trim(),
        status: 'unverified',
        statusLabel: getStatusLabel('unverified'),
        addedAt: new Date().toISOString(),
      });
    }
  }

  // Filter pool keys excluding known invalid / non-enterprise keys
  const validPool = apiKeyPool.filter(
    (k) => k.status !== 'non_enterprise' && k.status !== 'invalid' && !candidates.some((c) => c.key === k.key)
  );

  // Sort valid pool keys:
  // 1. Keys with HIGHEST RH Coins balance FIRST (Fast direct selection)
  // 2. Keys without recent error first
  // 3. Enterprise / active keys first
  validPool.sort((a, b) => {
    const aCoins = typeof a.remainCoins === 'number' ? a.remainCoins : -1;
    const bCoins = typeof b.remainCoins === 'number' ? b.remainCoins : -1;
    if (aCoins !== bCoins) {
      return bCoins - aCoins; // Descending: highest coins first!
    }

    const aHasErr = Boolean(a.lastError);
    const bHasErr = Boolean(b.lastError);
    if (!aHasErr && bHasErr) return -1;
    if (aHasErr && !bHasErr) return 1;

    if (a.status === 'enterprise' && b.status !== 'enterprise') return -1;
    if (a.status !== 'enterprise' && b.status === 'enterprise') return 1;

    return 0;
  });

  candidates.push(...validPool);
  return candidates;
}

// Helper to format paginated delete keys view
function formatDeleteKeysPage(page: number = 0, perPage: number = 6) {
  const total = apiKeyPool.length;
  if (total === 0) {
    return {
      text: `ℹ️ *KEY POOL KOSONG*\n\nTidak ada API Key yang tersimpan di server. Seluruh key telah dibersihkan! ✨`,
      keyboard: [
        [{ text: '➕ Tambah API Key', callback_data: 'ADD_KEY_PROMPT' }],
        [{ text: '➕ Bulk Import Key', callback_data: 'BULK_IMPORT' }],
        [{ text: '📋 Buka Key Pool', callback_data: 'KEY_POOL' }],
      ],
    };
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const start = currentPage * perPage;
  const end = Math.min(start + perPage, total);
  const pageItems = apiKeyPool.slice(start, end);

  let text = `🗑️ *PILIH API KEY UNTUK DIHAPUS*\n📑 *Halaman ${currentPage + 1} dari ${totalPages}* (Total: *${total} Key*)\n\n`;

  pageItems.forEach((item, i) => {
    const idx = start + i + 1;
    text += `*#${idx}* 🔑 \`${maskKey(item.key)}\`\n└ ${item.statusLabel}\n\n`;
  });

  text += `💡 *Cara Hapus Cepat:*\n• Klik tombol nomor di bawah untuk hapus per key.\n• Ketik \`/delkey ${start + 1}\` (atau \`/delkey 1 2 3\` untuk multi-hapus).\n• Klik tombol merah di bawah untuk hapus seluruh key sekaligus.`;

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  const numRow: Array<{ text: string; callback_data: string }> = [];

  pageItems.forEach((item, i) => {
    const idx = start + i + 1;
    const keyIdentifier = item.id || item.key.slice(-8);
    numRow.push({
      text: `🗑️ Hapus #${idx}`,
      callback_data: `DEL_KEY_HASH_${keyIdentifier}_P${currentPage}`,
    });
    if (numRow.length === 2) {
      keyboard.push([...numRow]);
      numRow.length = 0;
    }
  });
  if (numRow.length > 0) {
    keyboard.push([...numRow]);
  }

  // Navigation pagination
  if (totalPages > 1) {
    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (currentPage > 0) {
      navRow.push({ text: '◀️ Prev', callback_data: `DEL_PAGE_${currentPage - 1}` });
    }
    navRow.push({ text: `📄 ${currentPage + 1}/${totalPages}`, callback_data: `DEL_PAGE_${currentPage}` });
    if (currentPage < totalPages - 1) {
      navRow.push({ text: 'Next ▶️', callback_data: `DEL_PAGE_${currentPage + 1}` });
    }
    keyboard.push(navRow);
  }

  // Action buttons
  keyboard.push([
    { text: '💥 HAPUS SEMUA KEY (WIPE)', callback_data: 'CONFIRM_CLEAR_ALL' },
  ]);
  keyboard.push([
    { text: '📋 Kembali ke Pool', callback_data: 'KEY_POOL' },
    { text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' },
  ]);

  return { text, keyboard };
}

// Format Telegram API Key Pool Message
function formatTelegramPoolMessage(): string {
  const total = apiKeyPool.length;
  const statusStr = autoRotateEnabled ? '🟢 AKTIF (Otomatis rotasi saat error)' : '🔴 NONAKTIF';

  let text = `🔑 *RUNNINGHUB API KEY POOL*\nAuto Rotate: ${statusStr}\n\n`;

  if (total === 0) {
    text += `📋 *Daftar API Key:* (0 key)\n_Belum ada API Key di pool._\n\n💡 *Tambah key baru dengan format:*\n\`/addkey YOUR_API_KEY\` atau \`/key YOUR_API_KEY\`\natau klik tombol *[➕ BULK IMPORT]*`;
  } else {
    text += `📋 *Daftar API Key* (Total: ${total}):\n`;
    apiKeyPool.forEach((item, i) => {
      text += `${i + 1}. \`${maskKey(item.key)}\` (${item.statusLabel})\n`;
    });
    text += `\n💡 *Perintah Kelola & Hapus Key:*\n• \`/addkey KEY\` — Tambah Key baru\n• \`/delkey 1\` — Hapus Key nomor 1 (atau \`/delkey <KEY>\`)\n• \`/clearkeys\` atau \`/clearall\` — Hapus SEMUA key\n• \`/clearfailed\` — Hapus hanya key yang gagal/invalid`;
  }

  return text;
}

function getTelegramPoolInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '➕ BULK IMPORT API KEY', callback_data: 'BULK_IMPORT' },
        { text: '➕ Tambah 1 Key', callback_data: 'ADD_KEY_PROMPT' },
      ],
      [
        { text: `🔄 Auto Rotate: ${autoRotateEnabled ? 'ON' : 'OFF'}`, callback_data: 'TOGGLE_AUTO_ROTATE' },
        { text: '⚡ Verifikasi Semua', callback_data: 'VERIFY_ALL_KEYS' },
      ],
      [
        { text: '🗑️ Hapus Satu-Satu', callback_data: 'MANAGE_DELETE_KEYS' },
        { text: '🗑️ Hapus Key Failed', callback_data: 'CLEAR_FAILED_KEYS' },
      ],
      [
        { text: '💥 HAPUS SEMUA KEY', callback_data: 'CONFIRM_CLEAR_ALL' },
        { text: '❓ Panduan Enterprise', callback_data: 'ENTERPRISE_HELP' },
      ],
      [
        { text: '📋 Refresh Pool', callback_data: 'KEY_POOL' },
        { text: '⬅️ Menu Utama', callback_data: 'MAIN_MENU' },
      ],
    ],
  };
}

function cleanMarkdown(text: string): string {
  return text.replace(/[_*`\[\]]/g, '\\$&');
}

export interface BulkImportPendingData {
  fileName: string;
  totalLines: number;
  fileDuplicates: number;
  alreadyInPool: number;
  skippedLines: number;
  toImportKeys: string[];
}

export function parseBulkApiKeys(fileContent: string, fileName: string = 'keys.txt'): BulkImportPendingData {
  const lines = fileContent.split(/\r?\n/);
  const totalLines = lines.length;
  let fileDuplicates = 0;
  let alreadyInPool = 0;
  let skippedLines = 0;

  const seenInFile = new Set<string>();
  const toImportKeys: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // Ignore empty lines or comments starting with #
    if (!trimmed || trimmed.startsWith('#')) {
      skippedLines++;
      continue;
    }

    // Ignore lines that are too short to be a valid API key (e.g. less than 8 chars)
    if (trimmed.length < 8) {
      skippedLines++;
      continue;
    }

    // Check if duplicate within file
    if (seenInFile.has(trimmed)) {
      fileDuplicates++;
      continue;
    }
    seenInFile.add(trimmed);

    // Check if already exists in apiKeyPool
    const existsInPool = apiKeyPool.some((k) => k.key === trimmed);
    if (existsInPool) {
      alreadyInPool++;
      continue;
    }

    toImportKeys.push(trimmed);
  }

  return {
    fileName,
    totalLines,
    fileDuplicates,
    alreadyInPool,
    skippedLines,
    toImportKeys,
  };
}

function formatBulkImportPreview(data: BulkImportPendingData): string {
  return (
    `📥 *BULK IMPORT API KEY*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `📄 File: *${cleanMarkdown(data.fileName)}*\n\n` +
    `🔑 Total baris terbaca : *${data.totalLines}*\n` +
    `♻️ Duplikat file       : *${data.fileDuplicates}*\n` +
    `🔑 Sudah ada di pool   : *${data.alreadyInPool}*\n` +
    `⚠️ Baris dilewati      : *${data.skippedLines}*\n\n` +
    `✅ Akan diimpor        : *${data.toImportKeys.length}*\n\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `Lanjutkan import?`
  );
}

function formatBulkImportSuccess(data: BulkImportPendingData, addedCount: number): string {
  return (
    `✅ *BULK IMPORT BERHASIL*\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `📄 File: *${cleanMarkdown(data.fileName)}*\n\n` +
    `📦 Total diproses : *${data.totalLines}*\n` +
    `✅ Ditambahkan    : *${addedCount}*\n` +
    `♻️ Duplikat       : *${data.fileDuplicates}*\n` +
    `🔑 Sudah ada      : *${data.alreadyInPool}*\n` +
    `⚠️ Dilewati       : *${data.skippedLines}*\n` +
    `❌ Gagal           : *0*\n\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `🔑 Total Key Pool : *${apiKeyPool.length}*\n` +
    `🔄 Auto-Rotate    : *${autoRotateEnabled ? '🟢 AKTIF' : '🔴 NONAKTIF'}*\n\n` +
    `API Key baru sekarang sudah tersedia untuk sistem Auto-Rotate.`
  );
}

function getBulkImportPreviewKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '❌ BATAL', callback_data: 'BULK_IMPORT_CANCEL' },
        { text: '💾 IMPOR', callback_data: 'BULK_IMPORT_CONFIRM' },
      ],
    ],
  };
}

function getBulkImportPostKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📋 Buka Key Pool', callback_data: 'KEY_POOL' },
        { text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' },
      ],
    ],
  };
}

function getBulkResultInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '⬅️ Menu Utama', callback_data: 'MAIN_MENU' },
      ],
      [
        { text: `🔄 Auto Rotate: ${autoRotateEnabled ? 'ON' : 'OFF'}`, callback_data: 'TOGGLE_AUTO_ROTATE' },
        { text: '📋 Lihat Pool', callback_data: 'KEY_POOL' },
      ],
    ],
  };
}

// Process bulk key verification
async function processBulkKeys(rawKeys: string[]) {
  const uniqueKeys = Array.from(new Set(rawKeys.map((k) => k.trim()).filter((k) => k.length >= 8 && !k.startsWith('/'))));

  let enterpriseCount = 0;
  let nonEnterpriseCount = 0;
  let invalidCount = 0;

  const BATCH_SIZE = 5;
  for (let i = 0; i < uniqueKeys.length; i += BATCH_SIZE) {
    const chunk = uniqueKeys.slice(i, i + BATCH_SIZE);
    await Promise.all(
      chunk.map(async (keyStr) => {
        let existing = apiKeyPool.find((item) => item.key === keyStr);
        if (!existing) {
          existing = {
            id: `key-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            key: keyStr,
            status: 'unverified',
            statusLabel: getStatusLabel('unverified'),
            addedAt: new Date().toISOString(),
          };
          apiKeyPool.push(existing);
        }
        await verifyApiKeyItem(existing);
        if (existing.status === 'enterprise') enterpriseCount++;
        else if (existing.status === 'non_enterprise') nonEnterpriseCount++;
        else invalidCount++;
      })
    );
  }

  saveApiKeyPoolToFile();

  return {
    total: uniqueKeys.length,
    enterpriseCount,
    nonEnterpriseCount,
    invalidCount,
  };
}

// Helper to determine active RunningHub API key
function getApiKey(req: express.Request): string | undefined {
  const customKey = req.headers['x-runninghub-api-key'] as string;
  if (customKey && customKey.trim()) {
    return customKey.trim();
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();
    if (token && token !== 'RUNNINGHUB_API_KEY') {
      return token;
    }
  }
  // Try candidate from pool
  const candidates = getCandidateKeys();
  if (candidates.length > 0) {
    return candidates[0].key;
  }
  return process.env.RUNNINGHUB_API_KEY;
}

export type MotionModelId = 'wan-2.1' | 'motion-v2' | 'kling-v3.0' | 'kling-v2.6';

function getModelEndpoints(_model: string = 'wan-2.1'): string[] {
  return [
    'https://www.runninghub.ai/openapi/v2/rhart-video/wan2.2/character-motion-transfer',
    'https://www.runninghub.cn/openapi/v2/rhart-video/wan2.2/character-motion-transfer',
  ];
}

function getModelLabel(model: string = 'motion-v2'): string {
  const cfg = getMotionModelConfig(model);
  return cfg.name;
}

function getModelTag(model: string = 'motion-v2'): string {
  const cfg = getMotionModelConfig(model);
  return cfg.tag;
}

// Telegram Bot Engine State
let activeTelegramToken = process.env.TELEGRAM_BOT_TOKEN || '8876069186:AAEXSa3ozFlKX0PCr2jtt_2LJyiup-QsiHE';
let telegramBotInfo: { username?: string; first_name?: string; id?: number } | null = null;
let telegramBotStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
let telegramLastError: string | null = null;
let lastUpdateId = 0;
let telegramPollingActive = false;
let processedMessagesCount = 0;

// Per-Telegram User Session State
interface TelegramUserSession {
  step: 'idle' | 'awaiting_photo' | 'awaiting_video' | 'processing' | 'awaiting_key' | 'awaiting_bulk_file' | 'awaiting_bulk_keys' | 'awaiting_broadcast_message' | 'awaiting_broadcast_confirm';
  imageUrl?: string;
  videoUrl?: string;
  prompt?: string;
  userApiKey?: string;
  selectedModel?: MotionModelId;
  lastTaskId?: string;
  pendingBulkImport?: BulkImportPendingData;
  broadcastPayload?: {
    type: 'text' | 'photo' | 'video' | 'document';
    fileId?: string;
    text?: string;
    caption?: string;
    fullText?: string;
  };
}

const telegramSessions: Record<number, TelegramUserSession> = {};

// Send message to Telegram API
async function sendTelegramApi(method: string, payload: any) {
  if (!activeTelegramToken) return null;
  const url = `https://api.telegram.org/bot${activeTelegramToken}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      if (data.description && data.description.includes('message is not modified')) {
        return { ok: true, result: true };
      }
      if (payload.parse_mode) {
        console.warn(`[Telegram API Warning ${method}] ${data.description}, retrying without parse_mode`);
        const fallbackPayload = { ...payload };
        delete fallbackPayload.parse_mode;
        const fallbackRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fallbackPayload),
        });
        return await fallbackRes.json();
      }
    }
    return data;
  } catch (err: any) {
    console.error(`[Telegram API Error ${method}]`, err.message);
    return null;
  }
}

// 🗄️ LOCAL HIGH-SPEED VIDEO STORAGE & PROXY DIRECTORY
const VIDEO_STORAGE_DIR = path.join(process.cwd(), 'cached_videos');
if (!fs.existsSync(VIDEO_STORAGE_DIR)) {
  fs.mkdirSync(VIDEO_STORAGE_DIR, { recursive: true });
}

export function getPublicServerUrl(): string {
  const envUrl = process.env.APP_URL || '';
  if (envUrl && envUrl.startsWith('http')) {
    return envUrl.replace(/\/$/, '');
  }
  return 'https://ais-dev-sly5riwg74spreblqvg75j-653164865491.asia-southeast1.run.app';
}

// --- VIDEO PIPELINE: DOWNLOAD & VALIDATION ---
async function downloadAndVerifyVideo(
  fileUrl: string,
  taskId: string,
  maxRetries = 3
): Promise<{ buffer: Buffer; success: boolean; localPath?: string; error?: string }> {
  const cachedPath = path.join(VIDEO_STORAGE_DIR, `motion_control_${taskId}.mp4`);
  
  // If already cached and valid on local disk, return immediately
  if (fs.existsSync(cachedPath)) {
    try {
      const stats = fs.statSync(cachedPath);
      if (stats.size > 10 * 1024) {
        const buffer = fs.readFileSync(cachedPath);
        console.log(`[Video Pipeline] Using existing cached video (${(buffer.length / 1024 / 1024).toFixed(2)} MB): ${cachedPath}`);
        return { buffer, success: true, localPath: cachedPath };
      }
    } catch (e) {}
  }

  let lastError = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[Video Pipeline] Attempt ${attempt} to download & verify: ${taskId} (URL: ${fileUrl.slice(0, 80)}...)`);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 menit timeout

      const res = await fetch(fileUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TelegramBot/1.0)',
          'Accept': '*/*',
        },
      });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`Download failed with status ${res.status}`);

      const contentType = res.headers.get('content-type') || '';
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length === 0) throw new Error('Downloaded buffer is empty (size 0)');

      // Save directly into persistent local cache for high-speed delivery & streaming
      fs.writeFileSync(cachedPath, buffer);

      const stats = fs.statSync(cachedPath);
      if (stats.size === 0) throw new Error('Saved file is empty on disk');

      console.log(`[Video Pipeline] File ready: ${stats.size} bytes, Type: ${contentType}`);

      // FFmpeg / ffprobe validation
      console.log(`[Video Pipeline] Validating video container for ${taskId}...`);
      try {
        const probeOutput = execSync(
          `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,duration -of default=noprint_wrappers=1:nokey=1 "${cachedPath}"`,
          { stdio: 'pipe' }
        ).toString().trim();

        console.log(`[Video Pipeline] ✅ FFmpeg Validation SUCCESS for ${taskId}. Probe: ${probeOutput.replace(/\n/g, ', ')}`);
        return { buffer, success: true, localPath: cachedPath };
      } catch (ffErr: any) {
        // Fallback: If ffprobe throws but buffer is a valid MP4 size (>30KB), accept it
        if (buffer.length > 30 * 1024) {
          console.warn(`[Video Pipeline] ffprobe warning (${ffErr.message}), but video buffer is valid (${(buffer.length / 1024 / 1024).toFixed(2)} MB). Accepting video!`);
          return { buffer, success: true, localPath: cachedPath };
        }
        throw new Error(`FFmpeg validation failed: ${ffErr.message}`);
      }
    } catch (err: any) {
      lastError = err.message;
      console.error(`[Video Pipeline] Attempt ${attempt} failed for ${taskId}: ${lastError}`);
      if (fs.existsSync(cachedPath)) {
        try { fs.unlinkSync(cachedPath); } catch (e) {}
      }

      if (attempt < maxRetries) {
        const waitTime = attempt * 3000;
        console.log(`[Video Pipeline] Retrying in ${waitTime}ms...`);
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }
  }

  return { buffer: Buffer.alloc(0), success: false, error: lastError };
}

// Send file via multipart/form-data (download first on server, then upload to Telegram)
async function sendTelegramFileMultipart(
  method: 'sendVideo' | 'sendDocument',
  chatId: number,
  fileUrl: string,
  fileName: string,
  caption: string,
  replyToMessageId?: number,
  extraParams: Record<string, any> = {},
  preDownloadedBuffer?: Buffer
) {
  if (!activeTelegramToken) return null;
  console.log(`[Telegram] Starting sendTelegramFileMultipart: ${method} to chat ${chatId}`);
  try {
    let buffer: Buffer;
    if (preDownloadedBuffer && preDownloadedBuffer.length > 0) {
      buffer = preDownloadedBuffer;
      console.log(`[Telegram] Using pre-downloaded buffer (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      const taskId = fileName.replace('motion_control_', '').replace('.mp4', '');
      const verification = await downloadAndVerifyVideo(fileUrl, taskId);

      if (!verification.success) {
        throw new Error(`Pipeline Validation Failed: ${verification.error}`);
      }

      buffer = verification.buffer;
    }

    console.log(`[Telegram] Pipeline ready. Uploading ${(buffer.length / 1024 / 1024).toFixed(2)} MB to Telegram...`);

    const doUpload = async (useParseMode: boolean) => {
      const url = `https://api.telegram.org/bot${activeTelegramToken}/${method}`;
      const formData = new FormData();
      formData.append('chat_id', chatId.toString());

      const mimeType = method === 'sendVideo' ? 'video/mp4' : 'application/octet-stream';
      const blob = new Blob([buffer], { type: mimeType });
      const fieldName = method === 'sendVideo' ? 'video' : 'document';
      formData.append(fieldName, blob, fileName);

      // Sanitize caption if not using parse_mode
      const textCaption = useParseMode ? caption : caption.replace(/[*_`\[\]()]/g, '');
      formData.append('caption', textCaption);

      if (replyToMessageId) {
        formData.append('reply_to_message_id', replyToMessageId.toString());
      }

      for (const [key, val] of Object.entries(extraParams)) {
        if (key === 'parse_mode' && !useParseMode) continue;
        if (val !== undefined && val !== null) {
          if (typeof val === 'object') {
            formData.append(key, JSON.stringify(val));
          } else {
            formData.append(key, val.toString());
          }
        }
      }

      const uploadRes = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      return await uploadRes.json();
    };

    // 1. Initial attempt with Markdown formatting
    let result = await doUpload(true);
    console.log(`[Telegram] ${method} primary response:`, JSON.stringify(result));

    // 2. If Telegram fails with parse entities / formatting error, auto-retry with clean plain text caption!
    if (!result?.ok && result?.description && /parse entities|can't parse|entity/i.test(result.description)) {
      console.warn(`[Telegram] ${method} failed with parse_mode error (${result.description}). Retrying immediately without parse_mode...`);
      result = await doUpload(false);
      console.log(`[Telegram] ${method} retry without parse_mode response:`, JSON.stringify(result));
    }

    return result;
  } catch (err: any) {
    console.error(`[Telegram sendTelegramFileMultipart Error ${method}]`, err.message);
    return { ok: false, error: err.message };
  }
}

// Get File URL from Telegram
async function getTelegramFileUrl(fileId: string): Promise<string | null> {
  const res = await sendTelegramApi('getFile', { file_id: fileId });
  if (res?.ok && res?.result?.file_path) {
    return `https://api.telegram.org/file/bot${activeTelegramToken}/${res.result.file_path}`;
  }
  return null;
}

// Helper to check and retrieve user access state
function registerOrGetTelegramUser(
  fromUser: { id: number; first_name?: string; last_name?: string; username?: string },
  chatId: number
): { user: TelegramBotUser; isNew: boolean } {
  let user = botUsers.find((u) => u.id === fromUser.id);
  let isNew = false;
  const now = new Date().toISOString();
  const isOwnerAdmin = fromUser.id === SOLE_ADMIN_ID;

  if (!user) {
    isNew = true;
    user = {
      id: fromUser.id,
      chatId,
      firstName: fromUser.first_name || 'User',
      lastName: fromUser.last_name,
      username: fromUser.username,
      role: isOwnerAdmin ? 'admin' : 'user',
      status: isOwnerAdmin ? 'active' : 'pending',
      requestedAt: now,
      lastActiveAt: now,
      generatedCount: 0,
    };

    botUsers.push(user);
    saveTelegramUsers();

    if (!isOwnerAdmin) {
      notifyAdminsNewUser(user).catch((err) =>
        console.error('[Admin Notify Error]', err?.message || err)
      );
    }
  } else {
    user.chatId = chatId;
    if (fromUser.first_name) user.firstName = fromUser.first_name;
    if (fromUser.last_name !== undefined) user.lastName = fromUser.last_name;
    if (fromUser.username !== undefined) user.username = fromUser.username;
    user.lastActiveAt = now;

    if (isOwnerAdmin) {
      user.role = 'admin';
      user.status = 'active';
    } else {
      user.role = 'user';
    }
    saveTelegramUsers();
  }

  return { user, isNew };
}

async function notifyAdminsNewUser(user: TelegramBotUser) {
  const adminUsers = botUsers.filter((u) => u.role === 'admin' || adminUserIds.includes(u.id));
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';
  const usernameStr = user.username ? ` (@${user.username})` : '';

  const notifyText = `🔔 *PERMINTAAN AKSES USER BARU*\n\n👤 *Nama:* ${fullName}${usernameStr}\n🆔 *User ID:* \`${user.id}\`\n📅 *Waktu:* ${new Date(user.requestedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\nUser baru telah membuka bot dan meminta izin akses generate video. Silakan pilih tindakan:`;

  const inlineKeyboard = [
    [
      { text: '✅ Izinkan Akses', callback_data: `ADMIN_APPROVE_${user.id}` },
      { text: '❌ Tolak / Blokir', callback_data: `ADMIN_REJECT_${user.id}` },
    ],
  ];

  for (const admin of adminUsers) {
    if (admin.chatId) {
      await sendTelegramApi('sendMessage', {
        chat_id: admin.chatId,
        text: notifyText,
        reply_markup: { inline_keyboard: inlineKeyboard },
        parse_mode: 'Markdown',
      });
    }
  }
}

async function handleAdminApproveUser(
  adminChatId: number,
  adminUserId: number,
  targetUserId: number,
  messageId?: number
) {
  const targetUser = botUsers.find((u) => u.id === targetUserId);
  if (!targetUser) {
    if (messageId) {
      await sendTelegramApi('editMessageText', {
        chat_id: adminChatId,
        message_id: messageId,
        text: `⚠️ User dengan ID \`${targetUserId}\` tidak ditemukan.`,
        parse_mode: 'Markdown',
      });
    } else {
      await sendTelegramApi('sendMessage', {
        chat_id: adminChatId,
        text: `⚠️ User dengan ID \`${targetUserId}\` tidak ditemukan.`,
        parse_mode: 'Markdown',
      });
    }
    return;
  }

  targetUser.status = 'active';
  targetUser.approvedAt = new Date().toISOString();
  targetUser.approvedBy = adminUserId;
  saveTelegramUsers();

  const fullName = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ') || 'User';

  if (messageId) {
    await sendTelegramApi('editMessageText', {
      chat_id: adminChatId,
      message_id: messageId,
      text: `✅ *User Telah Diizinkan!*\n\n👤 *Nama:* ${fullName} ${targetUser.username ? `(@${targetUser.username})` : ''}\n🆔 *ID:* \`${targetUser.id}\`\nStatus: 🟢 *AKTIF (Siap Generate)*\n\nUser sekarang dapat langsung menggunakan bot.`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔴 Cabut Akses (Blokir)', callback_data: `ADMIN_REJECT_${targetUser.id}` }],
          [{ text: '👑 Kembali ke Menu Admin', callback_data: 'ADMIN_PANEL' }],
        ],
      },
      parse_mode: 'Markdown',
    });
  } else {
    await sendTelegramApi('sendMessage', {
      chat_id: adminChatId,
      text: `✅ *User Telah Diizinkan!*\n\n👤 *Nama:* ${fullName} ${targetUser.username ? `(@${targetUser.username})` : ''}\n🆔 *ID:* \`${targetUser.id}\`\nStatus: 🟢 *AKTIF (Siap Generate)*`,
      parse_mode: 'Markdown',
    });
  }

  // Notify the approved user
  if (targetUser.chatId) {
    await sendTelegramApi('sendMessage', {
      chat_id: targetUser.chatId,
      text: `🟢 *AKSES DIAKTIFKAN*\n\nAkses Anda ke Motion Control Bot telah diaktifkan kembali oleh Admin.`,
      parse_mode: 'Markdown',
    });
    await sendWelcomeMenu(targetUser.chatId);
  }
}

async function handleAdminRejectUser(
  adminChatId: number,
  adminUserId: number,
  targetUserId: number,
  messageId?: number
) {
  const targetUser = botUsers.find((u) => u.id === targetUserId);
  if (!targetUser) return;

  targetUser.status = 'blocked';
  targetUser.rejectedAt = new Date().toISOString();
  targetUser.blockedAt = new Date().toISOString();
  saveTelegramUsers();

  const fullName = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(' ') || 'User';

  if (messageId) {
    await sendTelegramApi('editMessageText', {
      chat_id: adminChatId,
      message_id: messageId,
      text: `🔴 User *${fullName}* (\`${targetUser.id}\`) telah diblokir / dinonaktifkan.`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '🟢 Aktifkan User', callback_data: `ADMIN_APPROVE_${targetUser.id}` }],
          [{ text: '👥 Semua Pengguna', callback_data: 'ADMIN_LIST_ALL' }],
          [{ text: '👑 Panel Admin', callback_data: 'ADMIN_PANEL' }],
        ],
      },
      parse_mode: 'Markdown',
    });
  } else {
    await sendTelegramApi('sendMessage', {
      chat_id: adminChatId,
      text: `🔴 User *${fullName}* (\`${targetUser.id}\`) telah dinonaktifkan.`,
      parse_mode: 'Markdown',
    });
  }

  // Notify the rejected/disabled user
  if (targetUser.chatId) {
    await sendBlockedAccessMessage(targetUser.chatId, targetUser.id);
  }
}

async function sendPendingAccessMessage(chatId: number, firstName?: string) {
  const name = firstName || 'Kak';
  await sendTelegramApi('sendMessage', {
    chat_id: chatId,
    text: `⏳ *Akses Belum Diaktifkan*\n\nHalo ${name}! Akun Anda saat ini tercatat sebagai:\n⏳ *Menunggu Persetujuan Admin*\n\nBot telah otomatis mengirim permintaan izin ke Admin. Anda tidak perlu mengisi data apa pun.\n\nBegitu Admin menyetujui akses Anda, bot akan langsung mengirimkan notifikasi dan membuka menu generator video. Mohon ditunggu ya! 🙏`,
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Cek Status Akses Sekarang', callback_data: 'CHECK_ACCESS_STATUS' }],
      ],
    },
    parse_mode: 'Markdown',
  });
}

async function sendBlockedAccessMessage(chatId: number, targetUserId?: number) {
  await sendTelegramApi('sendMessage', {
    chat_id: chatId,
    text: `❌ AKSES DITOLAK\n📩 HUBUNGI ADMIN`,
  });
}

async function broadcastModelEnabled(modelLabel: string) {
  for (const user of botUsers) {
    if (user.status === 'active' && user.chatId) {
      try {
        await sendTelegramApi('sendMessage', {
          chat_id: user.chatId,
          text: `🎉 *MODEL KEMBALI TERSEDIA*\n\n${modelLabel} telah diaktifkan kembali oleh Admin.\n\n✅ Kamu sekarang sudah dapat menggunakan model ini untuk generate video.\n\n🚀 Silakan pilih model dan mulai generate.`,
          parse_mode: 'Markdown',
        });
      } catch (err) {
        // Silently skip if user blocked the bot or other API issues
      }
    }
  }
}

async function sendAdminPanel(chatId: number) {
  const activeCount = botUsers.filter((u) => u.status === 'active' && u.role !== 'admin').length;
  const pendingCount = botUsers.filter((u) => u.status === 'pending').length;
  const blockedCount = botUsers.filter((u) => u.status === 'blocked').length;
  const activeKeysCount = apiKeyPool.length;

  const text = `👑 *MENU ADMIN*

👥 *MEMBER & PENGGUNA*
• 👤 Semua User: *${botUsers.length}* user
• 🟢 User Aktif: *${activeCount}* user
• 🔴 User Diblokir: *${blockedCount}* user
• ⏳ Permintaan Akses: *${pendingCount}* user

⚙️ *KONTROL MODEL*
• 🚀 Motion V2 — 1080HD: *${motionV2Enabled ? '🟢 Aktif' : '🔴 Nonaktif'}*
• ✨ Wan 2.1 V5: *${wanEnabled ? '🟢 Aktif' : '🔴 Nonaktif'}*

🔑 *ACCOUNT POOL*
• 🔑 RunningHub Key Pool: *${activeKeysCount}* key
• 📥 Bulk Import Keys

🛡️ *KEAMANAN & PENGUNCI SISTEM*
• 🔒 Super Admin ID: \`${SOLE_ADMIN_ID}\` (Terkunci Mutlak)
• 🛡️ Anti-Penyusup: *🟢 AKTIF & DILINDUNGI*
• 🔐 Master Security Code: *03042003 / 3 April 2003* (Hanya Admin)

⚙️ *SISTEM*
• 📊 Monitor Generate: *${generationTasks.length}* task
• ⏳ Auto-Delete Video (2 Hari): *🟢 AKTIF (${autoDeleteQueue.length} video terjadwal)*
• ⚙️ Pengaturan Engine: *${autoRotateEnabled ? 'Auto-Rotate' : 'Manual'}*

_Silakan pilih menu di bawah ini:_`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: '👤 Semua User', callback_data: 'ADMIN_LIST_ALL' },
        { text: '🟢 User Aktif', callback_data: 'ADMIN_LIST_ACTIVE' },
      ],
      [
        { text: '🔴 User Diblokir', callback_data: 'ADMIN_LIST_BLOCKED' },
        { text: '⏳ Permintaan Akses', callback_data: 'ADMIN_LIST_PENDING' },
      ],
      [
        { text: '📊 Monitor Generate', callback_data: 'ADMIN_MONITOR_TASKS' },
        { text: '🔑 Key Pool', callback_data: 'KEY_POOL' },
      ],
      [
        { text: `🚀 Motion V2: ${motionV2Enabled ? '🟢 AKTIF' : '🔴 NONAKTIF'}`, callback_data: 'ADMIN_TOGGLE_MODEL_MOTION_V2' },
        { text: `✨ Wan 2.1: ${wanEnabled ? '🟢 AKTIF' : '🔴 NONAKTIF'}`, callback_data: 'ADMIN_TOGGLE_MODEL_WAN' },
      ],
      [
        { text: '📊 Statistik', callback_data: 'ADMIN_STATS' },
        { text: '📢 Kirim Pemberitahuan (Broadcast)', callback_data: 'ADMIN_BROADCAST_START' },
      ],
      [
        { text: '⚙️ Pengaturan Engine', callback_data: 'SETTINGS' },
        { text: '⬅️ Menu Utama', callback_data: 'MAIN_MENU' },
      ],
    ],
  };

  await sendTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup,
    parse_mode: 'Markdown',
  });
}

async function sendMonitoringPanel(chatId: number) {
  const processingTasks = generationTasks.filter(t => t.status === 'PROCESSING' || t.status === 'QUEUED');
  const successTasks = generationTasks.filter(t => t.status === 'SUCCESS');
  const failedTasks = generationTasks.filter(t => t.status === 'FAILED');

  const statsText = `📊 *MONITOR GENERATE*

🔄 Sedang Diproses: *${processingTasks.length}*
✅ Berhasil: *${successTasks.length}*
❌ Gagal: *${failedTasks.length}*
📈 Total Task: *${generationTasks.length}*

---
*TASK TERBARU:*`;

  let taskListText = '';
  const recentTasks = generationTasks.slice(0, 5);

  if (recentTasks.length === 0) {
    taskListText = '\n_Belum ada riwayat task._';
  } else {
    recentTasks.forEach((t) => {
      const statusIcon = t.status === 'SUCCESS' ? '✅' : t.status === 'FAILED' ? '❌' : '🔄';
      const timeStr = new Date(t.startTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const modelName = t.model === 'motion-v2' ? '🚀 Motion V2' : '✨ Wan 2.1';
      
      taskListText += `\n\n${statusIcon} *Task #${t.id.slice(-6)}*
👤 Member: ${t.userName}
🎬 Model: ${modelName}
🆔 RunningHub ID: \`${t.id}\`
🔑 Key: \`${t.apiKeyId}\`
⏳ Status: ${t.status}
🕐 Waktu: ${timeStr}
${t.errorMessage ? `⚠️ Error: \`${t.errorMessage}\`` : ''}${t.duration ? `⏱️ Durasi: ${t.duration}s` : ''}`;
    });
  }

  await sendTelegramApi('sendMessage', {
    chat_id: chatId,
    text: statsText + taskListText,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Refresh Monitor', callback_data: 'ADMIN_MONITOR_TASKS' }],
        [{ text: '⬅️ Kembali ke Menu Admin', callback_data: 'ADMIN_PANEL' }],
      ],
    },
  });
}

async function sendPendingUsersList(chatId: number) {
  const pendings = botUsers.filter((u) => u.status === 'pending');
  if (pendings.length === 0) {
    await sendTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `✅ *Tidak ada user yang menunggu persetujuan!*\n\nSemua permintaan akses telah diproses.`,
      reply_markup: {
        inline_keyboard: [[{ text: '👑 Kembali ke Panel Admin', callback_data: 'ADMIN_PANEL' }]],
      },
      parse_mode: 'Markdown',
    });
    return;
  }

  let listText = `⏳ *DAFTAR USER MENUNGGU PERSETUJUAN (${pendings.length})*\n\n`;
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  pendings.slice(0, 8).forEach((u, i) => {
    const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
    const uName = u.username ? `@${u.username}` : '-';
    listText += `${i + 1}. *${fullName}* (${uName})\n   🆔 \`${u.id}\` | 📅 ${new Date(u.requestedAt).toLocaleTimeString('id-ID')}\n\n`;
    keyboard.push([
      { text: `✅ Izinkan ${fullName.slice(0, 10)}`, callback_data: `ADMIN_APPROVE_${u.id}` },
      { text: `❌ Tolak`, callback_data: `ADMIN_REJECT_${u.id}` },
    ]);
  });

  keyboard.push([{ text: '👑 Kembali ke Panel Admin', callback_data: 'ADMIN_PANEL' }]);

  await sendTelegramApi('sendMessage', {
    chat_id: chatId,
    text: listText,
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: 'Markdown',
  });
}

async function sendActiveUsersList(chatId: number) {
  const actives = botUsers.filter((u) => u.status === 'active');
  if (actives.length === 0) {
    await sendTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `ℹ️ Belum ada user aktif terdaftar.`,
      reply_markup: {
        inline_keyboard: [[{ text: '👑 Kembali ke Panel Admin', callback_data: 'ADMIN_PANEL' }]],
      },
      parse_mode: 'Markdown',
    });
    return;
  }

  let text = `🟢 *DAFTAR USER AKTIF (${actives.length})*\n\n`;
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  actives.slice(0, 8).forEach((u, i) => {
    const roleBadge = u.role === 'admin' ? '👑 Admin' : '👤 User';
    const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
    const uName = u.username ? `@${u.username}` : '-';
    text += `${i + 1}. *${fullName}* (${uName}) - ${roleBadge}\n   🆔 \`${u.id}\` | 🎬 Generate: ${u.generatedCount || 0}x\n\n`;
    if (u.role !== 'admin') {
      keyboard.push([
        { text: `🔴 Nonaktifkan ${fullName.slice(0, 12)}`, callback_data: `ADMIN_REJECT_${u.id}` },
      ]);
    }
  });

  keyboard.push([{ text: '👑 Kembali ke Panel Admin', callback_data: 'ADMIN_PANEL' }]);

  await sendTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: keyboard,
    },
    parse_mode: 'Markdown',
  });
}

async function sendBlockedUsersList(chatId: number) {
  const blockeds = botUsers.filter((u) => u.status === 'blocked');
  if (blockeds.length === 0) {
    await sendTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `✅ Tidak ada user yang diblokir saat ini.`,
      reply_markup: {
        inline_keyboard: [[{ text: '👑 Kembali ke Panel Admin', callback_data: 'ADMIN_PANEL' }]],
      },
      parse_mode: 'Markdown',
    });
    return;
  }

  let text = `🔴 *DAFTAR USER DIBLOKIR (${blockeds.length})*\n\n`;
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  blockeds.slice(0, 8).forEach((u, i) => {
    const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
    text += `${i + 1}. *${fullName}* (${u.username ? `@${u.username}` : '-'})\n   🆔 \`${u.id}\`\n\n`;
    keyboard.push([
      { text: `🟢 Buka Blokir (${fullName.slice(0, 12)})`, callback_data: `ADMIN_APPROVE_${u.id}` },
    ]);
  });

  keyboard.push([{ text: '👑 Kembali ke Panel Admin', callback_data: 'ADMIN_PANEL' }]);

  await sendTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: 'Markdown',
  });
}

async function sendAllUsersList(chatId: number) {
  if (botUsers.length === 0) {
    await sendTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `ℹ️ Belum ada user terdaftar di database bot.`,
      reply_markup: {
        inline_keyboard: [[{ text: '👑 Kembali ke Panel Admin', callback_data: 'ADMIN_PANEL' }]],
      },
    });
    return;
  }

  const totalMembers = botUsers.length;
  const activeMembers = botUsers.filter((u) => u.status === 'active').length;
  const inactiveMembers = botUsers.filter((u) => u.status !== 'active').length;
  const totalGenerations = botUsers.reduce((sum, u) => sum + (u.generatedCount || 0), 0);

  let text = `👥 SEMUA PENGGUNA TERDAFTAR (${totalMembers})\n\n━━━━━━━━━━━━━━━━━━━━━━\n\n📊 RINGKASAN\n👥 Total Member : ${totalMembers}\n🟢 Aktif : ${activeMembers}\n🔴 Nonaktif : ${inactiveMembers}\n🎬 Total Generate : ${totalGenerations}\n\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> = [];

  botUsers.forEach((u) => {
    const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'User';
    const roleStr = u.role === 'admin' ? 'ADMIN' : 'MEMBER';
    const roleIcon = u.role === 'admin' ? '👑' : '👤';
    const roleShield = u.role === 'admin' ? '🛡️' : '👤';
    const statusStr = u.status === 'active' ? 'ACTIVE' : 'INACTIVE';
    const statusIcon = u.status === 'active' ? '🟢' : '🔴';
    const regDate = (u.registeredAt || u.requestedAt) ? new Date(u.registeredAt || u.requestedAt).toLocaleDateString('id-ID') : '—';
    const lastActive = u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString('id-ID') : '—';

    text += `${roleIcon} ${fullName.toUpperCase()}\n🆔 "${u.id}"\n${roleShield} Role : ${roleStr}\n${statusIcon} Status : ${statusStr}\n🎬 Generate : ${u.generatedCount || 0}\n📅 Terdaftar : ${regDate}\n🕐 Aktivitas terakhir : ${lastActive}\n\n`;

    if (u.role === 'admin') {
      text += `🔒 Administrator\n\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    } else {
      text += `⚙️ Kontrol\n${u.status === 'active' ? '🔴 Nonaktifkan User' : '🟢 Aktifkan User'}\n\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      if (u.status === 'active') {
        inlineKeyboard.push([
          { text: `🔴 Nonaktifkan ${fullName.slice(0, 15)}`, callback_data: `ADMIN_REJECT_${u.id}` },
        ]);
      } else {
        inlineKeyboard.push([
          { text: `🟢 Aktifkan ${fullName.slice(0, 15)}`, callback_data: `ADMIN_APPROVE_${u.id}` },
        ]);
      }
    }
  });

  text += `📄 Halaman 1 / 1\n\n🔐 Hanya ADMIN yang dapat mengubah status pengguna.`;

  inlineKeyboard.push([
    { text: '👑 Kembali ke Panel Admin', callback_data: 'ADMIN_PANEL' },
  ]);

  await sendTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  });
}

async function sendCheckIdInfo(chatId: number, fromUser?: any) {
  const user = botUsers.find((u) => u.chatId === chatId || u.id === chatId);
  const targetId = fromUser?.id || user?.id || chatId;

  const text = `🆔 *ID Telegram Anda:*\n\`${targetId}\``;

  await sendTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: [
        [{ text: '⬅️ Menu Utama', callback_data: 'MAIN_MENU' }],
      ],
    },
    parse_mode: 'Markdown',
  });
}

// Send main Bot keyboard
async function sendWelcomeMenu(chatId: number, textPrefix = '') {
  const session = telegramSessions[chatId] || { step: 'idle', selectedModel: 'motion-v2' };
  const currentModel = session.selectedModel || 'motion-v2';
  const user = botUsers.find((u) => u.chatId === chatId || u.id === chatId);
  const isAdmin = user?.role === 'admin' || adminUserIds.includes(chatId);

  const statusBadge = formatMemberActiveStatusBadge(chatId, isAdmin);
  const userName = user?.firstName || 'Kak';
  const activeModelStr = currentModel === 'motion-v2' ? 'Motion V2 — 1080HD' : 'Wan 2.1 V5';

  const mainDescription = `👋 Halo, selamat datang, *${userName}*!\n\n⚡ *MOTION CONTROL*\nSistem ini dibuat untuk memudahkan kamu generate Motion Control tanpa ribet.\n\n📌 Model Aktif: *${activeModelStr}*${statusBadge ? `\n${statusBadge}` : ''}\n\n🚀 Pilih menu di bawah untuk mulai.🌸`;

  let text = textPrefix ? `${textPrefix.trim()}\n\n${mainDescription}` : mainDescription;

  const motionLabel = '🎬 MOTION V2 1080HD';
  const wanLabel = '✨ WAN 2.1 V5';

  const inlineKeyboard: any[][] = [
    [
      { text: motionLabel, callback_data: 'SET_MODEL_MOTION_V2' },
      { text: wanLabel, callback_data: 'SET_MODEL_WAN' },
    ],
    [
      { text: '📋 RIWAYAT', callback_data: 'HISTORY' },
      { text: '⚙️ PENGATURAN', callback_data: 'SETTINGS' },
    ],
    [
      { text: '◈ 🆔 CEK ID', callback_data: 'CHECK_MY_ID' },
    ],
  ];

  if (isAdmin) {
    inlineKeyboard.push([
      { text: '👑 ADMIN PANEL', callback_data: 'ADMIN_PANEL' },
    ]);
  }

  await sendTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
    parse_mode: 'Markdown',
  });
}

// 🛡️ GLOBAL TELEGRAM DEDUPLICATION & SINGLETON IDEMPOTENCY ENGINE
let activePollingInstanceId = 0;
const processedUpdateIds = new Map<number, number>(); // update_id -> timestamp
const processedCallbackIds = new Map<string, number>(); // callback_query.id -> timestamp
const processedMessageKeys = new Map<string, number>(); // `${chatId}:${message_id}` -> timestamp

// Auto-eviction routine to prevent memory leaks (keeps memory bounded)
setInterval(() => {
  const now = Date.now();
  const THIRTY_MINUTES = 30 * 60 * 1000;
  for (const [id, ts] of processedUpdateIds.entries()) {
    if (now - ts > THIRTY_MINUTES) processedUpdateIds.delete(id);
  }
  for (const [id, ts] of processedCallbackIds.entries()) {
    if (now - ts > THIRTY_MINUTES) processedCallbackIds.delete(id);
  }
  for (const [key, ts] of processedMessageKeys.entries()) {
    if (now - ts > THIRTY_MINUTES) processedMessageKeys.delete(key);
  }
}, 5 * 60 * 1000);

// Start Telegram Polling Loop with Guaranteed Single-Instance Control
async function initTelegramBotEngine() {
  if (!activeTelegramToken || activeTelegramToken.trim().length < 10) {
    telegramBotStatus = 'disconnected';
    return;
  }

  telegramBotStatus = 'connecting';
  telegramLastError = null;

  try {
    // Clear any active webhooks and drop stale duplicate updates from Telegram server
    await sendTelegramApi('deleteWebhook', { drop_pending_updates: true });

    const me = await sendTelegramApi('getMe', {});
    if (me?.ok && me?.result) {
      telegramBotInfo = me.result;
      telegramBotStatus = 'connected';
      console.log(`[Telegram Bot] Connected successfully as @${me.result.username} (${me.result.first_name})`);

      // 🧹 Set clean native Telegram menu command (ONLY 🏠 Menu Utama)
      await sendTelegramApi('setMyCommands', {
        commands: [
          { command: 'start', description: '🏠 Menu Utama' }
        ]
      });
    } else {
      telegramBotStatus = 'error';
      telegramLastError = me?.description || 'Failed to authenticate Telegram Bot Token';
      console.error('[Telegram Bot Auth Error]', telegramLastError);
      return;
    }
  } catch (err: any) {
    telegramBotStatus = 'error';
    telegramLastError = err.message;
    return;
  }

  activePollingInstanceId++;
  const currentInstanceId = activePollingInstanceId;
  telegramPollingActive = true;

  console.log(`[Telegram Polling] Starting singleton polling loop instance #${currentInstanceId}...`);

  // Background polling loop
  (async () => {
    while (telegramPollingActive && currentInstanceId === activePollingInstanceId && activeTelegramToken) {
      try {
        const updatesRes = await sendTelegramApi('getUpdates', {
          offset: lastUpdateId + 1,
          timeout: 5,
        });

        // If another instance was spawned while waiting for getUpdates, exit immediately
        if (currentInstanceId !== activePollingInstanceId) {
          console.log(`[Telegram Polling] Instance #${currentInstanceId} superseded by #${activePollingInstanceId}. Terminating old loop gracefully.`);
          break;
        }

        if (updatesRes?.error_code === 409) {
          console.warn('[Telegram Polling] 409 Conflict detected. Clearing webhook and waiting 5s...');
          await sendTelegramApi('deleteWebhook', { drop_pending_updates: false });
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        if (updatesRes?.ok && Array.isArray(updatesRes.result)) {
          for (const update of updatesRes.result) {
            // Check if superseded
            if (currentInstanceId !== activePollingInstanceId) break;

            lastUpdateId = Math.max(lastUpdateId, update.update_id);

            // 🛡️ Global Deduplication: Ignore already-processed updates
            if (processedUpdateIds.has(update.update_id)) {
              continue;
            }
            processedUpdateIds.set(update.update_id, Date.now());
            processedMessagesCount++;

            // Handle callback queries (inline button clicks)
            if (update.callback_query) {
              const query = update.callback_query;
              const cbId = String(query.id);

              // 🛡️ Global Deduplication: Ignore duplicate callback queries
              if (processedCallbackIds.has(cbId)) {
                try {
                  await sendTelegramApi('answerCallbackQuery', { callback_query_id: query.id });
                } catch (e) {}
                continue;
              }
              processedCallbackIds.set(cbId, Date.now());

              const chatId = query.message?.chat?.id;
              const data = query.data;
              const fromUser = query.from;

              await sendTelegramApi('answerCallbackQuery', { callback_query_id: query.id });

              if (chatId && fromUser) {
                const { user } = registerOrGetTelegramUser(fromUser, chatId);
                const isAdmin = user.role === 'admin' || adminUserIds.includes(fromUser.id);

                if (!telegramSessions[chatId]) {
                  telegramSessions[chatId] = { step: 'idle' };
                }

                // Non-admin blocked or pending user intercept for any callback interaction
                if (!isAdmin) {
                  if (user.status === 'blocked') {
                    await sendBlockedAccessMessage(chatId, fromUser.id);
                    continue;
                  }
                  if (user.status === 'pending') {
                    await sendPendingAccessMessage(chatId, user.firstName);
                    continue;
                  }
                }

                // 1. Admin Actions
                if (data.startsWith('ADMIN_') || data === 'CLEAR_ALL_KEYS' || data === 'CLEAR_FAILED_KEYS' || data === 'KEY_POOL' || data.startsWith('DEL_KEY_') || data.startsWith('DEL_PAGE_') || data === 'MANAGE_DELETE_KEYS') {
                  if (!isAdmin) {
                    // Instantly block and blacklist this unauthorized intruder permanently
                    user.status = 'blocked';
                    user.role = 'user';
                    user.blockedAt = new Date().toISOString();
                    user.rejectedAt = new Date().toISOString();
                    saveTelegramUsers();

                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `AKSES DI TOLAK SEMUA ANDA DI BLOKIR PERMANEN!!`,
                    });

                    // Notify the real Sole Admin (8781652064)
                    await sendTelegramApi('sendMessage', {
                      chat_id: SOLE_ADMIN_ID,
                      text: `🚨 *PERINGATAN KEAMANAN BOT: USER DIBLOKIR OTOMATIS*\n\nUser mencoba mengakses fitur Admin tanpa hak izin:\n• *Nama:* ${user.firstName} ${user.lastName || ''} (@${user.username || '-'})\n• *User ID:* \`${user.id}\`\n• *Aksi Ilegal:* Tombol \`${data}\`\n\n🛡️ *Tindakan Sistem:* Akun telah *DIBLOKIR PERMANEN* seketika.`,
                      parse_mode: 'Markdown',
                    });
                    continue;
                  }

                  if (data.startsWith('ADMIN_APPROVE_')) {
                    const targetId = parseInt(data.replace('ADMIN_APPROVE_', ''), 10);
                    if (!isNaN(targetId)) {
                      await handleAdminApproveUser(chatId, fromUser.id, targetId, query.message?.message_id);
                    }
                    continue;
                  }

                  if (data.startsWith('ADMIN_REJECT_')) {
                    const targetId = parseInt(data.replace('ADMIN_REJECT_', ''), 10);
                    if (!isNaN(targetId)) {
                      await handleAdminRejectUser(chatId, fromUser.id, targetId, query.message?.message_id);
                    }
                    continue;
                  }

                  if (data === 'ADMIN_PANEL') {
                    await sendAdminPanel(chatId);
                    continue;
                  }

                  if (data === 'ADMIN_LIST_PENDING') {
                    await sendPendingUsersList(chatId);
                    continue;
                  }

                  if (data === 'ADMIN_LIST_ACTIVE') {
                    await sendActiveUsersList(chatId);
                    continue;
                  }

                  if (data === 'ADMIN_LIST_BLOCKED') {
                    await sendBlockedUsersList(chatId);
                    continue;
                  }

                  if (data === 'ADMIN_LIST_ALL') {
                    await sendAllUsersList(chatId);
                    continue;
                  }

                  if (data === 'ADMIN_STATS') {
                    const activeCount = botUsers.filter((u) => u.status === 'active' && u.role !== 'admin').length;
                    const pendingCount = botUsers.filter((u) => u.status === 'pending').length;
                    const blockedCount = botUsers.filter((u) => u.status === 'blocked').length;
                    const adminCount = botUsers.filter((u) => u.role === 'admin').length;
                    const totalGenerations = botUsers.reduce((sum, u) => sum + (u.generatedCount || 0), 0);
                    const activeKeysCount = apiKeyPool.length;

                    const statsText = `📊 *STATISTIK SISTEM BOT*
                    
👥 *Pengguna:*
• Total Terdaftar: *${botUsers.length}* user
• Aktif: *${activeCount}* user
• Diblokir: *${blockedCount}* user
• Menunggu Persetujuan: *${pendingCount}* user
• Administrator: *${adminCount}* orang

🎬 *Aktivitas:*
• Total Generate Video: *${totalGenerations}* task
• Rata-rata task per user: *${(totalGenerations / Math.max(botUsers.length, 1)).toFixed(1)}* task

🔑 *RunningHub Engine:*
• API Key Pool: *${activeKeysCount}* key
• Mode Auto-Rotate: *${autoRotateEnabled ? '🟢 Aktif' : '🔴 Nonaktif'}*`;

                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: statsText,
                      reply_markup: {
                        inline_keyboard: [
                          [{ text: '👑 Kembali ke Panel Admin', callback_data: 'ADMIN_PANEL' }],
                        ],
                      },
                      parse_mode: 'Markdown',
                    });
                    continue;
                  }

                  if (data === 'ADMIN_BROADCAST_START') {
                    telegramSessions[chatId].step = 'awaiting_broadcast_message';
                    delete telegramSessions[chatId].broadcastPayload;
                    const activeMembersCount = botUsers.filter((u) => u.status === 'active' && u.id !== SOLE_ADMIN_ID).length;

                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `📢 *PANEL PEMBERITAHUAN (BROADCAST MEMBER)*\n\n` +
                        `🎯 *Target Penerima:* ${activeMembersCount} Member Terdaftar\n\n` +
                        `Silakan kirimkan *pesan pengumuman/pemberitahuan* yang ingin Anda sampaikan ke seluruh member.\n\n` +
                        `📌 *Format Pesan Yang Didukung:*\n` +
                        `• Teks Biasa / Format Markdown (*bold*, _italic_, \`code\`, link)\n` +
                        `• Foto dengan Keterangan (Caption)\n` +
                        `• Video dengan Keterangan (Caption)\n` +
                        `• Dokumen / File dengan Keterangan\n\n` +
                        `✍️ *Silakan ketik atau kirim pesan Anda sekarang:*`,
                      reply_markup: {
                        inline_keyboard: [
                          [{ text: '❌ BATAL BROADCAST', callback_data: 'ADMIN_BROADCAST_CANCEL' }],
                          [{ text: '👑 Panel Admin', callback_data: 'ADMIN_PANEL' }],
                        ],
                      },
                      parse_mode: 'Markdown',
                    });
                    continue;
                  }

                  if (data === 'ADMIN_BROADCAST_CANCEL') {
                    telegramSessions[chatId].step = 'idle';
                    delete telegramSessions[chatId].broadcastPayload;
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `❌ *PROSES BROADCAST DIBATALKAN*\n\nTidak ada pesan pengumuman yang dikirim ke member.`,
                      reply_markup: {
                        inline_keyboard: [
                          [{ text: '📢 Buka Panel Pemberitahuan', callback_data: 'ADMIN_BROADCAST_START' }],
                          [{ text: '👑 Panel Admin', callback_data: 'ADMIN_PANEL' }],
                        ],
                      },
                      parse_mode: 'Markdown',
                    });
                    continue;
                  }

                  if (data === 'ADMIN_BROADCAST_CONFIRM') {
                    const payload = telegramSessions[chatId]?.broadcastPayload;
                    if (!payload) {
                      await sendTelegramApi('sendMessage', {
                        chat_id: chatId,
                        text: `⚠️ *Data pesan broadcast tidak ditemukan atau sudah kedaluwarsa.*`,
                        reply_markup: { inline_keyboard: [[{ text: '👑 Panel Admin', callback_data: 'ADMIN_PANEL' }]] },
                        parse_mode: 'Markdown',
                      });
                      telegramSessions[chatId].step = 'idle';
                      continue;
                    }

                    telegramSessions[chatId].step = 'idle';
                    const targetUsers = botUsers.filter((u) => u.status === 'active' && u.id !== SOLE_ADMIN_ID);

                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `🚀 *MEMULAI PENGIRIMAN BROADCAST...*\n\nPesan sedang dikirim ke *${targetUsers.length}* member. Mohon tunggu sejenak...`,
                      parse_mode: 'Markdown',
                    });

                    let successCount = 0;
                    let failedCount = 0;
                    let blockedCount = 0;

                    for (const u of targetUsers) {
                      const targetChatId = u.chatId || u.id;
                      try {
                        let res: any;
                        if (payload.type === 'photo' && payload.fileId) {
                          res = await sendTelegramApi('sendPhoto', {
                            chat_id: targetChatId,
                            photo: payload.fileId,
                            caption: payload.caption || '',
                            parse_mode: 'Markdown',
                          });
                        } else if (payload.type === 'video' && payload.fileId) {
                          res = await sendTelegramApi('sendVideo', {
                            chat_id: targetChatId,
                            video: payload.fileId,
                            caption: payload.caption || '',
                            parse_mode: 'Markdown',
                          });
                        } else if (payload.type === 'document' && payload.fileId) {
                          res = await sendTelegramApi('sendDocument', {
                            chat_id: targetChatId,
                            document: payload.fileId,
                            caption: payload.caption || '',
                            parse_mode: 'Markdown',
                          });
                        } else {
                          res = await sendTelegramApi('sendMessage', {
                            chat_id: targetChatId,
                            text: payload.text || payload.caption || '',
                            parse_mode: 'Markdown',
                          });
                        }

                        if (res && res.ok) {
                          successCount++;
                        } else {
                          failedCount++;
                          if (res && (res.error_code === 403 || res.description?.includes('blocked'))) {
                            blockedCount++;
                          }
                        }
                      } catch (err) {
                        failedCount++;
                      }

                      await new Promise((r) => setTimeout(r, 35));
                    }

                    delete telegramSessions[chatId].broadcastPayload;

                    const reportText = `✅ *PEMBERITAHUAN (BROADCAST) SELESAI DIKIRIM!*

📊 *LAPORAN PENGIRIMAN:*
• 👥 Total Member Target: *${targetUsers.length}* member
• ✅ Berhasil Terkirim: *${successCount}* member
• ❌ Gagal Dikirim: *${failedCount}* member ${blockedCount > 0 ? `(_${blockedCount} di antaranya memblokir bot_)` : ''}
• 📅 Waktu Selesai: *${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}*

📢 *Keterangan:* Seluruh member terdaftar telah menerima pengumuman terbaru dari Admin.`;

                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: reportText,
                      reply_markup: {
                        inline_keyboard: [
                          [{ text: '📢 Kirim Broadcast Lagi', callback_data: 'ADMIN_BROADCAST_START' }],
                          [{ text: '👑 Kembali ke Panel Admin', callback_data: 'ADMIN_PANEL' }],
                        ],
                      },
                      parse_mode: 'Markdown',
                    });
                    continue;
                  }
                }

                // 2. User Status Check
                if (data === 'CHECK_ACCESS_STATUS') {
                  if (user.status === 'active') {
                    await sendWelcomeMenu(chatId, `🎉 *Akses Anda Sudah Aktif!*\n\n`);
                  } else if (user.status === 'blocked') {
                    await sendBlockedAccessMessage(chatId);
                  } else {
                    await sendPendingAccessMessage(chatId, user.firstName);
                  }
                  continue;
                }

                if (data === 'CHECK_MY_ID' || data === 'CEK_ID') {
                  await sendCheckIdInfo(chatId, fromUser);
                  continue;
                }

                // Guard non-admin users if blocked or pending
                if (!isAdmin && user.status === 'blocked') {
                  await sendBlockedAccessMessage(chatId);
                  continue;
                }
                if (!isAdmin && user.status === 'pending') {
                  await sendPendingAccessMessage(chatId, user.firstName);
                  continue;
                }

                // 3. User & Engine Actions
                if (data === 'API_KEY' || data === 'KEY_POOL') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `ℹ️ RunningHub Key Pool dikelola secara terpusat oleh Admin Server. Anda tidak perlu memasukkan API key sendiri.`,
                    });
                    continue;
                  }
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: formatTelegramPoolMessage(),
                    reply_markup: getTelegramPoolInlineKeyboard(),
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'ADMIN_TOGGLE_MODEL_MOTION_V2') {
                  if (!isAdmin) continue;
                  const wasEnabled = motionV2Enabled;
                  motionV2Enabled = !motionV2Enabled;
                  saveBotConfig();
                  
                  const msg = `✅ *STATUS MODEL DIPERBARUI*\n\n🚀 *Motion V2 — 1080HD* sekarang ${motionV2Enabled ? '🟢 AKTIF' : '🔴 NONAKTIF'}.`;
                  
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: msg,
                    parse_mode: 'Markdown',
                  });

                  if (!wasEnabled && motionV2Enabled) {
                    broadcastModelEnabled('🚀 *Motion V2 — 1080HD*');
                  }
                  
                  await sendAdminPanel(chatId);
                  continue;
                } else if (data === 'ADMIN_TOGGLE_MODEL_WAN') {
                  if (!isAdmin) continue;
                  const wasEnabled = wanEnabled;
                  wanEnabled = !wanEnabled;
                  saveBotConfig();
                  
                  const msg = `✅ *STATUS MODEL DIPERBARUI*\n\n✨ *Wan 2.1 V5* sekarang ${wanEnabled ? '🟢 AKTIF' : '🔴 NONAKTIF'}.`;
                  
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: msg,
                    parse_mode: 'Markdown',
                  });

                  if (!wasEnabled && wanEnabled) {
                    broadcastModelEnabled('✨ *Wan 2.1 V5*');
                  }
                  
                  await sendAdminPanel(chatId);
                  continue;
                } else if (data === 'ADMIN_MONITOR_TASKS') {
                  if (!isAdmin) continue;
                  await sendMonitoringPanel(chatId);
                  continue;
                } else if (data === 'SET_MODEL_WAN') {
                  if (!wanEnabled && !isAdmin) {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `🚫 *MODEL SEMENTARA TIDAK TERSEDIA*\n\nMohon maaf atas ketidaknyamanannya. 🙏\n\n✨ *Wan 2.1 V5* saat ini sedang dinonaktifkan oleh Admin.\n\n❌ Generate menggunakan model ini sementara tidak dapat dilakukan.\n\n🔄 Silakan pilih model lain yang masih tersedia.\n\n🙏 Terima kasih atas pengertiannya.`,
                      parse_mode: 'Markdown',
                    });
                    continue;
                  }
                  if (!isAdmin && getMemberActiveCount(chatId) >= 2) {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: PARALLEL_LIMIT_REJECTION_TEXT,
                      parse_mode: 'Markdown',
                    });
                    continue;
                  }
                  telegramSessions[chatId].selectedModel = 'wan-2.1';
                  telegramSessions[chatId].step = 'awaiting_photo';
                  telegramSessions[chatId].imageUrl = undefined;
                  telegramSessions[chatId].videoUrl = undefined;
                  const currentActive = getMemberActiveCount(chatId);
                  const activeBadge = isAdmin ? '' : `\n\n🎬 *GENERATE*\n${currentActive === 0 ? '🟢 *Aktif:* 0/2' : '🟠 *Aktif:* 1/2'}`;
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `✨ *Model dipilih: WAN 2.1 V5*${activeBadge}\n\n📸 *Langkah 1/2: Kirim Foto Karakter*\nSilakan kirimkan 1 foto karakter/orang yang ingin digerakkan (bisa berupa foto langsung atau dokumen gambar).`,
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'SET_MODEL_MOTION_V2') {
                  if (!motionV2Enabled && !isAdmin) {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `🚫 *MODEL SEMENTARA TIDAK TERSEDIA*\n\nMohon maaf atas ketidaknyamanannya. 🙏\n\n🚀 *Motion V2 — 1080HD* saat ini sedang dinonaktifkan oleh Admin.\n\n❌ Generate menggunakan model ini sementara tidak dapat dilakukan.\n\n🔄 Silakan pilih model lain yang masih tersedia.\n\n🙏 Terima kasih atas pengertiannya.`,
                      parse_mode: 'Markdown',
                    });
                    continue;
                  }
                  if (!isAdmin && getMemberActiveCount(chatId) >= 2) {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: PARALLEL_LIMIT_REJECTION_TEXT,
                      parse_mode: 'Markdown',
                    });
                    continue;
                  }
                  telegramSessions[chatId].selectedModel = 'motion-v2';
                  telegramSessions[chatId].step = 'awaiting_photo';
                  telegramSessions[chatId].imageUrl = undefined;
                  telegramSessions[chatId].videoUrl = undefined;
                  const currentActive = getMemberActiveCount(chatId);
                  const activeBadge = isAdmin ? '' : `\n\n🎬 *GENERATE*\n${currentActive === 0 ? '🟢 *Aktif:* 0/2' : '🟠 *Aktif:* 1/2'}`;
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `🚀 *Model dipilih: MOTION V2 — 1080P*${activeBadge}\n\n📸 *Langkah 1/2: Kirim Foto Karakter*\nSilakan kirimkan 1 foto karakter/orang yang ingin digerakkan (bisa berupa foto langsung atau dokumen gambar).`,
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'MAIN_MENU') {
                  await sendWelcomeMenu(chatId);
                } else if (data === 'BULK_IMPORT') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  telegramSessions[chatId].step = 'awaiting_bulk_file';
                  delete telegramSessions[chatId].pendingBulkImport;
                  const promptMsg =
                    `📄 *Silakan kirim file .txt yang berisi API Key.*\n\n` +
                    `📌 *Format:* 1 API Key per baris.\n` +
                    `_Baris komentar (#) dan spasi otomatis diabaikan._`;
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: promptMsg,
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '❌ BATAL', callback_data: 'BULK_IMPORT_CANCEL' }],
                        [{ text: '📋 Buka Key Pool', callback_data: 'KEY_POOL' }],
                      ],
                    },
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'BULK_IMPORT_CANCEL') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  delete telegramSessions[chatId].pendingBulkImport;
                  telegramSessions[chatId].step = 'idle';
                  const cancelText = `❌ *IMPORT DIBATALKAN*\n\nTidak ada perubahan pada Key Pool.`;
                  const cancelMarkup = getBulkImportPostKeyboard();
                  if (query.message?.message_id) {
                    await sendTelegramApi('editMessageText', {
                      chat_id: chatId,
                      message_id: query.message.message_id,
                      text: cancelText,
                      reply_markup: cancelMarkup,
                      parse_mode: 'Markdown',
                    });
                  } else {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: cancelText,
                      reply_markup: cancelMarkup,
                      parse_mode: 'Markdown',
                    });
                  }
                } else if (data === 'BULK_IMPORT_CONFIRM') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  const pending = telegramSessions[chatId]?.pendingBulkImport;
                  if (!pending || !pending.toImportKeys || pending.toImportKeys.length === 0) {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `⚠️ *Tidak Ada Data Impor*\n\nSesi impor telah kedaluwarsa atau tidak ditemukan. Silakan ulangi proses bulk import.`,
                      reply_markup: getTelegramPoolInlineKeyboard(),
                      parse_mode: 'Markdown',
                    });
                    telegramSessions[chatId].step = 'idle';
                    continue;
                  }

                  const now = new Date().toISOString();
                  const addedItems: ApiKeyPoolItem[] = [];
                  for (const keyStr of pending.toImportKeys) {
                    if (!apiKeyPool.some((k) => k.key === keyStr)) {
                      const item: ApiKeyPoolItem = {
                        id: `key-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                        key: keyStr,
                        status: 'unverified',
                        statusLabel: getStatusLabel('unverified'),
                        addedAt: now,
                      };
                      apiKeyPool.push(item);
                      addedItems.push(item);
                    }
                  }

                  saveApiKeyPoolToFile();

                  // Async background verification without blocking Telegram UI
                  (async () => {
                    for (const item of addedItems) {
                      await verifyApiKeyItem(item);
                    }
                    saveApiKeyPoolToFile();
                  })().catch((err) => console.error('[Bulk Import Async Verify Error]', err));

                  const successText = formatBulkImportSuccess(pending, addedItems.length);
                  const successMarkup = getBulkImportPostKeyboard();

                  delete telegramSessions[chatId].pendingBulkImport;
                  telegramSessions[chatId].step = 'idle';

                  if (query.message?.message_id) {
                    await sendTelegramApi('editMessageText', {
                      chat_id: chatId,
                      message_id: query.message.message_id,
                      text: successText,
                      reply_markup: successMarkup,
                      parse_mode: 'Markdown',
                    });
                  } else {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: successText,
                      reply_markup: successMarkup,
                      parse_mode: 'Markdown',
                    });
                  }
                } else if (data === 'ADD_KEY_PROMPT') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  telegramSessions[chatId].step = 'awaiting_key';
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `➕ *TAMBAH API KEY LANGSUNG*\n\nSilakan langsung kirim / tempel (*paste*) API Key RunningHub Anda di sini:\n\n💡 _Anda juga bisa mengirim banyak key sekaligus (1 key per baris). Tanpa perlu ketik ID atau perintah tambahan!_`,
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '❌ Batal', callback_data: 'KEY_POOL' }],
                        [{ text: '📋 Buka Key Pool', callback_data: 'KEY_POOL' }],
                      ],
                    },
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'TOGGLE_AUTO_ROTATE') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  autoRotateEnabled = !autoRotateEnabled;
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `🔄 Auto Rotate sekarang: *${autoRotateEnabled ? '🟢 AKTIF' : '🔴 NONAKTIF'}*\n\n${
                      autoRotateEnabled
                        ? 'Sistem akan otomatis mencoba key berikutnya jika key utama gagal / ditolak.'
                        : 'Sistem hanya akan menggunakan key pertama.'
                    }`,
                    reply_markup: getTelegramPoolInlineKeyboard(),
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'VERIFY_ALL_KEYS') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `⚡ Memulai verifikasi ${apiKeyPool.length} key di Pool...`,
                  });
                  for (let i = 0; i < apiKeyPool.length; i++) {
                    await verifyApiKeyItem(apiKeyPool[i]);
                  }
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `✅ Verifikasi selesai!\n\n${formatTelegramPoolMessage()}`,
                    reply_markup: getTelegramPoolInlineKeyboard(),
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'CLEAR_FAILED_KEYS') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  const before = apiKeyPool.length;
                  const failedKeys = apiKeyPool.filter((k) => k.status !== 'enterprise' && k.status !== 'unverified');
                  failedKeys.forEach((item) => {
                    if (item.key && !deletedKeysList.includes(item.key)) {
                      deletedKeysList.push(item.key);
                    }
                  });
                  saveDeletedKeys();
                  apiKeyPool = apiKeyPool.filter((k) => k.status === 'enterprise' || k.status === 'unverified');
                  const removed = before - apiKeyPool.length;
                  saveApiKeyPoolToFile();
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `🗑️ Berhasil menghapus ${removed} key yang gagal / non-Enterprise-Shared!\n\n${formatTelegramPoolMessage()}`,
                    reply_markup: getTelegramPoolInlineKeyboard(),
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'CONFIRM_CLEAR_ALL') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  const confirmText = `💥 *KONFIRMASI HAPUS SEMUA KEY*\n\nApakah Anda yakin ingin menghapus seluruh *${apiKeyPool.length} API Key* di pool?\n\n_Seluruh key akan langsung dibersihkan dari server._`;
                  const confirmMarkup = {
                    inline_keyboard: [
                      [
                        { text: '💥 YA, HAPUS SEMUA SEKARANG', callback_data: 'CLEAR_ALL_KEYS' },
                      ],
                      [
                        { text: '🔙 Batal / Kembali ke Pool', callback_data: 'KEY_POOL' },
                      ],
                    ],
                  };

                  if (query.message?.message_id) {
                    const r = await sendTelegramApi('editMessageText', {
                      chat_id: chatId,
                      message_id: query.message.message_id,
                      text: confirmText,
                      reply_markup: confirmMarkup,
                      parse_mode: 'Markdown',
                    });
                    if (r?.ok) continue;
                  }
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: confirmText,
                    reply_markup: confirmMarkup,
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'MANAGE_DELETE_KEYS') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  const view = formatDeleteKeysPage(0);
                  if (query.message?.message_id) {
                    const r = await sendTelegramApi('editMessageText', {
                      chat_id: chatId,
                      message_id: query.message.message_id,
                      text: view.text,
                      reply_markup: { inline_keyboard: view.keyboard },
                      parse_mode: 'Markdown',
                    });
                    if (r?.ok) continue;
                  }
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: view.text,
                    reply_markup: { inline_keyboard: view.keyboard },
                    parse_mode: 'Markdown',
                  });
                } else if (data.startsWith('DEL_PAGE_')) {
                  if (!isAdmin) continue;
                  const pageNum = parseInt(data.replace('DEL_PAGE_', ''), 10) || 0;
                  const view = formatDeleteKeysPage(pageNum);
                  if (query.message?.message_id) {
                    await sendTelegramApi('editMessageText', {
                      chat_id: chatId,
                      message_id: query.message.message_id,
                      text: view.text,
                      reply_markup: { inline_keyboard: view.keyboard },
                      parse_mode: 'Markdown',
                    });
                  }
                } else if (data.startsWith('DEL_KEY_HASH_')) {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  // Extract hash & target page (format: DEL_KEY_HASH_<hash>_P<page>)
                  const raw = data.replace('DEL_KEY_HASH_', '');
                  const parts = raw.split('_P');
                  const targetHash = parts[0];
                  const pageNum = parts[1] ? parseInt(parts[1], 10) : 0;

                  const foundIdx = apiKeyPool.findIndex(
                    (k) => (k.id && k.id === targetHash) || k.key.endsWith(targetHash) || k.key.includes(targetHash)
                  );

                  let removedKeyLabel = '';
                  if (foundIdx >= 0) {
                    const [removed] = apiKeyPool.splice(foundIdx, 1);
                    if (removed?.key && !deletedKeysList.includes(removed.key)) {
                      deletedKeysList.push(removed.key);
                      saveDeletedKeys();
                    }
                    saveApiKeyPoolToFile();
                    removedKeyLabel = maskKey(removed.key);
                    await sendTelegramApi('answerCallbackQuery', {
                      callback_query_id: query.id,
                      text: `🗑️ Key ${removedKeyLabel} berhasil dihapus permanen!`,
                      show_alert: false,
                    });
                  } else {
                    await sendTelegramApi('answerCallbackQuery', {
                      callback_query_id: query.id,
                      text: `⚠️ Key tidak ditemukan atau sudah dihapus.`,
                      show_alert: true,
                    });
                  }

                  const view = formatDeleteKeysPage(pageNum);
                  if (query.message?.message_id) {
                    const r = await sendTelegramApi('editMessageText', {
                      chat_id: chatId,
                      message_id: query.message.message_id,
                      text: view.text,
                      reply_markup: { inline_keyboard: view.keyboard },
                      parse_mode: 'Markdown',
                    });
                    if (!r?.ok) {
                      await sendTelegramApi('sendMessage', {
                        chat_id: chatId,
                        text: view.text,
                        reply_markup: { inline_keyboard: view.keyboard },
                        parse_mode: 'Markdown',
                      });
                    }
                  }
                } else if (data === 'CLEAR_ALL_KEYS') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  const removed = apiKeyPool.length;
                  apiKeyPool.forEach((item) => {
                    if (item.key && !deletedKeysList.includes(item.key)) {
                      deletedKeysList.push(item.key);
                    }
                  });
                  saveDeletedKeys();
                  apiKeyPool = [];
                  saveApiKeyPoolToFile();
                  const doneText = `🗑️ *Seluruh ${removed} API Key di Pool telah dihapus bersih!*\n\n${formatTelegramPoolMessage()}`;
                  const doneMarkup = getTelegramPoolInlineKeyboard();

                  if (query.message?.message_id) {
                    const r = await sendTelegramApi('editMessageText', {
                      chat_id: chatId,
                      message_id: query.message.message_id,
                      text: doneText,
                      reply_markup: doneMarkup,
                      parse_mode: 'Markdown',
                    });
                    if (r?.ok) continue;
                  }
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: doneText,
                    reply_markup: doneMarkup,
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'ENTERPRISE_HELP') {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `🏢 *PANDUAN ENTERPRISE-SHARED API KEY RUNNINGHUB*\n\nRunningHub mewajibkan tipe *Enterprise-Shared API Key* untuk model Motion Control (Wan 2.1 & Kling v3.0).\n\n📌 *Langkah Membuat Enterprise Key di RunningHub:*\n1. Buka [RunningHub.ai](https://www.runninghub.ai) atau [RunningHub.cn](https://www.runninghub.cn)\n2. Masuk ke menu *API Management / OpenAPI*\n3. Pilih tab *Enterprise-Shared API Key* (atau buat API Key di bawah Tim/Enterprise Workspace)\n4. Salin API Key 32-karakter yang dihasilkan\n5. Tambahkan ke Bot dengan mengetik:\n   \`/addkey API_KEY_ANDA\`\n   atau klik tombol *[➕ BULK IMPORT]* untuk memasukkan banyak key sekaligus.\n\n💡 *Tips:* Aktifkan *Auto Rotate* agar bot otomatis beralih jika salah satu key di pool habis kuota!`,
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '➕ Tambah API Key Sekarang', callback_data: 'ADD_KEY_PROMPT' }],
                        [{ text: '📋 Lihat Key Pool', callback_data: 'KEY_POOL' }],
                        [{ text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' }],
                      ],
                    },
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'START_GENERATE') {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `⚠️ *Fitur Dinonaktifkan*\n\nTombol "Generate Video" sebagai menu terpisah sudah dinonaktifkan.\n\nSilakan langsung pilih model di menu utama untuk mulai:\n🚀 *Motion V2 — 1080HD*\n✨ *Wan 2.1 V5*`,
                    parse_mode: 'Markdown',
                  });
                  continue;
                } else if (data === 'SETTINGS') {
                  const activeModel = telegramSessions[chatId]?.selectedModel || 'motion-v2';
                  const activePrompt = telegramSessions[chatId]?.prompt || DEFAULT_REALISTIC_PROMPT;
                  const buttons: any[][] = [
                    [
                      { text: '🚀 Motion V2 — 1080HD', callback_data: 'SET_MODEL_MOTION_V2' },
                      { text: '✨ Wan 2.1 V5', callback_data: 'SET_MODEL_WAN' },
                    ],
                  ];

                  if (isAdmin) {
                    buttons.push([
                      { text: '🔄 Ganti Mode Auto-Rotate', callback_data: 'TOGGLE_AUTO_ROTATE' },
                      { text: '✍️ Lihat Prompt Master', callback_data: 'VIEW_PROMPT' },
                    ]);
                  }

                  buttons.push([
                    { text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' },
                  ]);

                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `⚙️ *PENGATURAN MOTION CONTROL*\n\n🎯 *Model Aktif:* ${getModelLabel(activeModel)}\n${formatModelDetailsTelegram(activeModel)}\n\n📐 *Format Video:* 9:16 Vertical (Full HD 1080p)\n🔊 *Audio Asli:* Dipertahankan Otomatis\n⚡ *Status Antrean:* Siap Generate`,
                    reply_markup: {
                      inline_keyboard: buttons,
                    },
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'SELECT_MODEL') {
                  const currentM = telegramSessions[chatId]?.selectedModel || 'motion-v2';
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `🎯 *PILIH MODEL MOTION CONTROL*\n\nPilih model Motion Control yang ingin digunakan:\n\n` +
                      `1️⃣ *MOTION V2 (1080HD)* ${currentM === 'motion-v2' ? '✅ (Aktif)' : ''}\n` +
                      `   📌 Workflow ID: \`${EMBEDDED_MOTION_MODELS['motion-v2'].workflowId}\`\n` +
                      `   💎 Output 1080HD Ultra Sharp\n\n` +
                      `2️⃣ *WAN 2.1 (V5)* ${currentM === 'wan-2.1' ? '✅ (Aktif)' : ''}\n` +
                      `   📌 Workflow ID: \`2001911147597033473\`\n` +
                      `   💎 Wan animate动作迁移 V5\n\n` +
                      `Klik tombol di bawah untuk beralih:`,
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: `🚀 MOTION V2 (1080HD) ${currentM === 'motion-v2' ? '✓' : ''}`, callback_data: 'SET_MODEL_MOTION_V2' }],
                        [{ text: `🌟 WAN 2.1 V5 ${currentM === 'wan-2.1' ? '✓' : ''}`, callback_data: 'SET_MODEL_WAN' }],
                        [{ text: '🔙 Kembali ke Pengaturan', callback_data: 'SETTINGS' }],
                      ],
                    },
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'VIEW_PROMPT') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  const activePrompt = telegramSessions[chatId]?.prompt || DEFAULT_REALISTIC_PROMPT;
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `✍️ *PROMPT MOTION CONTROL AKTIF*\n\n\`\`\`\n${activePrompt}\n\`\`\`\n\n📌 *Negative Prompt:* \n\`\`\`\n${DEFAULT_REALISTIC_NEGATIVE_PROMPT}\n\`\`\`\n\n💡 *Kustomisasi:* Ketik \`/setprompt <teks>\` atau \`/resetprompt\``,
                    reply_markup: {
                      inline_keyboard: [
                        [
                          { text: '🚀 Motion V2 — 1080HD', callback_data: 'SET_MODEL_MOTION_V2' },
                          { text: '✨ Wan 2.1 V5', callback_data: 'SET_MODEL_WAN' },
                        ],
                        [{ text: '🔄 Reset ke Prompt Master', callback_data: 'RESET_PROMPT' }],
                        [{ text: '🔙 Kembali ke Menu', callback_data: 'MAIN_MENU' }],
                      ],
                    },
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'RESET_PROMPT') {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                    continue;
                  }
                  telegramSessions[chatId].prompt = undefined;
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `🔄 *Prompt Direset ke Master Realistic Prompt:*\n\n\`\`\`\n${DEFAULT_REALISTIC_PROMPT}\n\`\`\``,
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' }],
                      ],
                    },
                    parse_mode: 'Markdown',
                  });
                } else if (data === 'HISTORY') {
                  const historyView = formatHistoryViewTelegram(chatId, isAdmin);
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: historyView.text,
                    reply_markup: {
                      inline_keyboard: historyView.keyboard,
                    },
                    parse_mode: 'Markdown',
                  });
                }
              }
            }

            // Handle standard text / media messages
            if (update.message) {
              const msg = update.message;
              const chatId = msg.chat?.id;
              if (!chatId) continue;

              const msgKey = `${chatId}:${msg.message_id}`;
              // 🛡️ Global Deduplication: Ignore duplicate message IDs
              if (processedMessageKeys.has(msgKey)) {
                continue;
              }
              processedMessageKeys.set(msgKey, Date.now());

              const text = msg.text?.trim() || '';
              const fromUser = msg.from;

              if (!fromUser) continue;

              const { user } = registerOrGetTelegramUser(fromUser, chatId);
              const isAdmin = user.role === 'admin' || adminUserIds.includes(fromUser.id);

              if (!telegramSessions[chatId]) {
                telegramSessions[chatId] = { step: 'idle' };
              }
              const session = telegramSessions[chatId];

              // Intercept blocked and pending users BEFORE any commands or media handling
              if (!isAdmin) {
                if (user.status === 'blocked') {
                  await sendBlockedAccessMessage(chatId);
                  continue;
                }
                if (user.status === 'pending' && text !== '/start') {
                  await sendPendingAccessMessage(chatId, user.firstName);
                  continue;
                }
              }

              // Handle /history, /riwayat, /status, /jobs, /antrian
              if (text === '/history' || text === '/riwayat' || text === '/status' || text === '/jobs' || text === '/antrian') {
                const historyView = formatHistoryViewTelegram(chatId, isAdmin);
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: historyView.text,
                  reply_markup: {
                    inline_keyboard: historyView.keyboard,
                  },
                  parse_mode: 'Markdown',
                });
                continue;
              }

              // Handle /start
              if (text === '/start') {
                session.step = 'idle';
                if (isAdmin) {
                  await sendWelcomeMenu(chatId);
                } else if (user.status === 'active') {
                  await sendWelcomeMenu(chatId);
                } else if (user.status === 'blocked') {
                  await sendBlockedAccessMessage(chatId);
                } else {
                  await sendPendingAccessMessage(chatId, user.firstName);
                }
                continue;
              }

              // Handle /cancel, /batal, /reset, /ulang
              if (text === '/cancel' || text === '/batal' || text === '/reset' || text === '/ulang') {
                session.step = 'idle';
                session.imageUrl = undefined;
                session.videoUrl = undefined;
                session.prompt = undefined;
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `🔄 *Sesi Motion Control Direset!*\n\nFoto dan video sebelumnya telah dibersihkan. Silakan pilih model di menu utama untuk memulai proses baru.`,
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: '🚀 Motion V2 — 1080HD', callback_data: 'SET_MODEL_MOTION_V2' },
                        { text: '✨ Wan 2.1 V5', callback_data: 'SET_MODEL_WAN' },
                      ],
                      [{ text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' }],
                    ],
                  },
                  parse_mode: 'Markdown',
                });
                continue;
              }

              // Handle /myid, /id, /cekid, /checkid
              if (text === '/myid' || text === '/id' || text === '/cekid' || text === '/checkid') {
                await sendCheckIdInfo(chatId, fromUser);
                continue;
              }

              // ADMIN COMMANDS (Strict Sole-Admin Guarded)
              if (isAdmin) {
                if (text === '/admin' || text === '/panel') {
                  await sendAdminPanel(chatId);
                  continue;
                }

                if (text === '/keys' || text === '/keypool') {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: formatTelegramPoolMessage(),
                    reply_markup: getTelegramPoolInlineKeyboard(),
                    parse_mode: 'Markdown',
                  });
                  continue;
                }

                if (text === '/addkey' || text === '/key' || text === '/tambahkey' || text === '/addkeys') {
                  session.step = 'awaiting_key';
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `➕ *TAMBAH API KEY LANGSUNG*\n\nSilakan langsung kirim / tempel (*paste*) API Key RunningHub Anda di sini:\n\n💡 _Tanpa perlu ketik ID atau perintah apa pun! Anda juga bisa langsung kirim banyak key sekaligus (1 key per baris)._`,
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '❌ Batal', callback_data: 'KEY_POOL' }],
                        [{ text: '📋 Buka Key Pool', callback_data: 'KEY_POOL' }],
                      ],
                    },
                    parse_mode: 'Markdown',
                  });
                  continue;
                }

                if (text.startsWith('/addkey ') || text.startsWith('/key ') || text.startsWith('/tambahkey ')) {
                  const newKey = text.replace('/addkey ', '').replace('/key ', '').replace('/tambahkey ', '').trim().replace(/^["']|["']$/g, '');
                  if (newKey.length >= 8) {
                    // Un-blacklist if previously deleted
                    if (deletedKeysList.includes(newKey)) {
                      deletedKeysList = deletedKeysList.filter((k) => k !== newKey);
                      saveDeletedKeys();
                    }

                    let existingItem = apiKeyPool.find((k) => k.key === newKey);
                    if (!existingItem) {
                      existingItem = {
                        id: `key-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                        key: newKey,
                        status: 'unverified',
                        statusLabel: getStatusLabel('unverified'),
                        addedAt: new Date().toISOString(),
                      };
                      apiKeyPool.unshift(existingItem);
                    }

                    const testMsg = await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `⏳ *Memverifikasi API Key langsung...*\nKey: \`${maskKey(newKey)}\`\nStatus: 🟡 Belum diverifikasi`,
                      parse_mode: 'Markdown',
                    });

                    await verifyApiKeyItem(existingItem);
                    saveApiKeyPoolToFile();

                    const successMsg = `✅ *API Key Berhasil Ditambahkan Langsung!*\n\n🔑 Key: \`${maskKey(newKey)}\`\n📊 Status: ${existingItem.statusLabel}\n\n${formatTelegramPoolMessage()}`;
                    const replyKbd = getTelegramPoolInlineKeyboard();

                    if (testMsg?.ok && testMsg?.result?.message_id) {
                      await sendTelegramApi('editMessageText', {
                        chat_id: chatId,
                        message_id: testMsg.result.message_id,
                        text: successMsg,
                        reply_markup: replyKbd,
                        parse_mode: 'Markdown',
                      });
                    } else {
                      await sendTelegramApi('sendMessage', {
                        chat_id: chatId,
                        text: successMsg,
                        reply_markup: replyKbd,
                        parse_mode: 'Markdown',
                      });
                    }
                  } else {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `❌ Format salah. Ketik: \`/addkey <API_KEY_RUNNINGHUB>\` atau langsung tempel key Anda di sini.`,
                      parse_mode: 'Markdown',
                    });
                  }
                  continue;
                }

                if (text === '/pending' || text === '/listpending') {
                  await sendPendingUsersList(chatId);
                  continue;
                }

                if (text === '/users' || text === '/listusers') {
                  await sendAllUsersList(chatId);
                  continue;
                }

                if (text.startsWith('/approve ') || text.startsWith('/izinkan ')) {
                  const targetIdStr = text.replace('/approve ', '').replace('/izinkan ', '').trim();
                  const targetId = parseInt(targetIdStr, 10);
                  if (!isNaN(targetId)) {
                    await handleAdminApproveUser(chatId, fromUser.id, targetId);
                  } else {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `❌ Format ID salah. Contoh: \`/approve 12345678\``,
                      parse_mode: 'Markdown',
                    });
                  }
                  continue;
                }

                if (text.startsWith('/block ') || text.startsWith('/tolak ') || text.startsWith('/reject ')) {
                  const targetIdStr = text.replace('/block ', '').replace('/tolak ', '').replace('/reject ', '').trim();
                  const targetId = parseInt(targetIdStr, 10);
                  if (!isNaN(targetId)) {
                    await handleAdminRejectUser(chatId, fromUser.id, targetId);
                  } else {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `❌ Format ID salah. Contoh: \`/block 12345678\``,
                      parse_mode: 'Markdown',
                    });
                  }
                  continue;
                }

                if (text.startsWith('/unblock ') || text.startsWith('/buka ')) {
                  const targetIdStr = text.replace('/unblock ', '').replace('/buka ', '').trim();
                  const targetId = parseInt(targetIdStr, 10);
                  if (!isNaN(targetId)) {
                    await handleAdminApproveUser(chatId, fromUser.id, targetId);
                  } else {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `❌ Format ID salah. Contoh: \`/unblock 12345678\``,
                      parse_mode: 'Markdown',
                    });
                  }
                  continue;
                }

                if (text === '/broadcast' || text === '/pengumuman' || text === '/pemberitahuan') {
                  session.step = 'awaiting_broadcast_message';
                  delete session.broadcastPayload;
                  const activeMembersCount = botUsers.filter((u) => u.status === 'active' && u.id !== SOLE_ADMIN_ID).length;

                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `📢 *PANEL PEMBERITAHUAN (BROADCAST MEMBER)*\n\n` +
                      `🎯 *Target Penerima:* ${activeMembersCount} Member Terdaftar\n\n` +
                      `Silakan kirimkan *pesan pengumuman/pemberitahuan* yang ingin Anda sampaikan ke seluruh member.\n\n` +
                      `📌 *Format Pesan Yang Didukung:*\n` +
                      `• Teks Biasa / Format Markdown (*bold*, _italic_, \`code\`, link)\n` +
                      `• Foto dengan Keterangan (Caption)\n` +
                      `• Video dengan Keterangan (Caption)\n` +
                      `• Dokumen / File dengan Keterangan\n\n` +
                      `✍️ *Silakan ketik atau kirim pesan Anda sekarang:*`,
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '❌ BATAL BROADCAST', callback_data: 'ADMIN_BROADCAST_CANCEL' }],
                        [{ text: '👑 Panel Admin', callback_data: 'ADMIN_PANEL' }],
                      ],
                    },
                    parse_mode: 'Markdown',
                  });
                  continue;
                }

                if (text.startsWith('/setadmin ') || text.startsWith('/deladmin ')) {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `🔒 *TIDAK DIIZINKAN*\n\nStruktur kepengurusan bot ini telah dikunci permanen oleh Super Admin. Pengguna lain hanya dapat mengakses bot sebagai *Member*.`,
                    parse_mode: 'Markdown',
                  });
                  continue;
                }
              } else {
                // Non-admin attempting to execute admin commands -> INSTANT BLOCK
                const isAdminCmd =
                  text === '/admin' ||
                  text === '/panel' ||
                  text === '/pending' ||
                  text === '/listpending' ||
                  text === '/users' ||
                  text === '/listusers' ||
                  text === '/broadcast' ||
                  text === '/pengumuman' ||
                  text === '/pemberitahuan' ||
                  text.startsWith('/approve') ||
                  text.startsWith('/izinkan') ||
                  text.startsWith('/block') ||
                  text.startsWith('/tolak') ||
                  text.startsWith('/reject') ||
                  text.startsWith('/unblock') ||
                  text.startsWith('/setadmin') ||
                  text.startsWith('/deladmin');

                if (isAdminCmd) {
                  user.status = 'blocked';
                  user.role = 'user';
                  user.blockedAt = new Date().toISOString();
                  user.rejectedAt = new Date().toISOString();
                  saveTelegramUsers();

                  await sendBlockedAccessMessage(chatId);

                  await sendTelegramApi('sendMessage', {
                    chat_id: SOLE_ADMIN_ID,
                    text: `🚨 *PERINGATAN KEAMANAN BOT: USER DIBLOKIR OTOMATIS*\n\nUser mencoba menjalankan perintah khusus Admin:\n• *Nama:* ${user.firstName} ${user.lastName || ''} (@${user.username || '-'})\n• *User ID:* \`${user.id}\`\n• *Perintah Ilegal:* \`${text}\`\n\n🛡️ *Tindakan Sistem:* Akun telah *DIBLOKIR* seketika.`,
                    parse_mode: 'Markdown',
                  });
                  continue;
                }
              }

              // Access Check for regular users
              if (!isAdmin) {
                if (user.status === 'blocked') {
                  await sendBlockedAccessMessage(chatId);
                  continue;
                }
                if (user.status === 'pending') {
                  await sendPendingAccessMessage(chatId, user.firstName);
                  continue;
                }
              }

              // Active / Admin user flow:

              // Handle Prompt Inspection and Customization Commands
              if (text === '/prompt' || text === '/lihatprompt' || text === '/getprompt') {
                const activePrompt = session.prompt || DEFAULT_REALISTIC_PROMPT;
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `✍️ *PROMPT MOTION CONTROL AKTIF*\n\n\`\`\`\n${activePrompt}\n\`\`\`\n\n📌 *Negative Prompt:* \n\`\`\`\n${DEFAULT_REALISTIC_NEGATIVE_PROMPT}\n\`\`\`\n\n💡 *Kustomisasi Prompt:* \n• Ketik \`/setprompt <teks prompt>\` untuk mengganti prompt.\n• Ketik \`/resetprompt\` untuk mengembalikan prompt standar master.\n• Atau sertakan teks langsung pada *caption* foto/video Anda.`,
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: '🚀 Motion V2 — 1080HD', callback_data: 'SET_MODEL_MOTION_V2' },
                        { text: '✨ Wan 2.1 V5', callback_data: 'SET_MODEL_WAN' },
                      ],
                      [{ text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' }],
                    ],
                  },
                  parse_mode: 'Markdown',
                });
                continue;
              }

              if (text.startsWith('/setprompt ') || text.startsWith('/customprompt ')) {
                const newPrompt = text.replace('/setprompt ', '').replace('/customprompt ', '').trim();
                if (newPrompt.length > 5) {
                  session.prompt = newPrompt;
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `✅ *Prompt Kustom Berhasil Disimpan!*\n\n\`\`\`\n${newPrompt}\n\`\`\`\n\nPrompt ini akan digunakan untuk proses generate berikutnya! 🚀`,
                    reply_markup: {
                      inline_keyboard: [
                        [
                          { text: '🚀 Motion V2 — 1080HD', callback_data: 'SET_MODEL_MOTION_V2' },
                          { text: '✨ Wan 2.1 V5', callback_data: 'SET_MODEL_WAN' },
                        ],
                        [{ text: '🔄 Reset ke Prompt Master', callback_data: 'RESET_PROMPT' }],
                      ],
                    },
                    parse_mode: 'Markdown',
                  });
                } else {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `❌ Prompt terlalu pendek. Contoh: \`/setprompt Create a high-quality motion control...\``,
                  });
                }
                continue;
              }

              if (text === '/resetprompt') {
                session.prompt = undefined;
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `🔄 *Prompt Berhasil Direset ke Master Default:*\n\n\`\`\`\n${DEFAULT_REALISTIC_PROMPT}\n\`\`\``,
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: '🚀 Motion V2 — 1080HD', callback_data: 'SET_MODEL_MOTION_V2' },
                        { text: '✨ Wan 2.1 V5', callback_data: 'SET_MODEL_WAN' },
                      ],
                      [{ text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' }],
                    ],
                  },
                  parse_mode: 'Markdown',
                });
                continue;
              }

              // Handle Model Switch Commands
              if (text === '/motionv2' || text === '/v2' || text === '/motion2') {
                session.selectedModel = 'motion-v2';
                const cfg = EMBEDDED_MOTION_MODELS['motion-v2'];
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `🚀 *Model Diubah ke: MOTION V2 (1080HD)*\n\n📌 *Active Workflow ID:* \`${cfg.workflowId}\`\n🖼️ *Node Foto ID:* \`${cfg.imageNodeId}\`\n🎥 *Node Video ID:* \`${cfg.videoNodeId}\`\n💎 *Resolusi:* \`1080p Full HD (1080HD Output)\`\n\n✅ *Spesifikasi MOTION V2:*\n• High-definition 1080p motion transfer & pose alignment\n• Output tajam 1080HD Crystal Clear\n• Retargeting gerakan halus & sinkronisasi audio\n\nSilakan tekan tombol di bawah ini untuk memulai.`,
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🎬 MULAI GENERATE SEKARANG', callback_data: 'SET_MODEL_MOTION_V2' }],
                      [{ text: '🌟 Switch ke WAN 2.1 V5', callback_data: 'SET_MODEL_WAN' }],
                      [{ text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' }],
                    ],
                  },
                  parse_mode: 'Markdown',
                });
                continue;
              }

              if (text === '/wan' || text === '/wan21' || text === '/wan-2.1') {
                session.selectedModel = 'wan-2.1';
                const cfg = EMBEDDED_MOTION_MODELS['wan-2.1'];
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `🌟 *Model Diubah ke: WAN 2.1 MOTION CONTROL (Alibaba)*\n\n📌 *Active Workflow ID:* \`${cfg.workflowId}\`\n🖼️ *Node Foto ID:* \`${cfg.imageNodeId}\`\n🎥 *Node Video ID:* \`${cfg.videoNodeId}\`\n💎 *Resolusi:* \`1080p Full HD (1080HD Wajib)\`\n\n• Superior character pose & garment dynamics\n• Output tajam 1080p Full HD crystal clear\n• Full audio sync & orientation options\n\nSilakan tekan tombol di bawah ini untuk memulai.`,
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🎬 MULAI GENERATE SEKARANG', callback_data: 'SET_MODEL_WAN' }],
                      [{ text: '🚀 Switch ke MOTION V2', callback_data: 'SET_MODEL_MOTION_V2' }],
                      [{ text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' }],
                    ],
                  },
                  parse_mode: 'Markdown',
                });
                continue;
              }

              if (text === '/model' || text === '/models') {
                const currentM = session.selectedModel || 'motion-v2';
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `🎯 *PILIH MODEL MOTION CONTROL*\n\nPilih model Motion Control yang ingin digunakan:\n\n` +
                    `1️⃣ *MOTION V2 (1080HD)* ${currentM === 'motion-v2' ? '✅ (Aktif)' : ''}\n` +
                    `   📌 Workflow ID: \`${EMBEDDED_MOTION_MODELS['motion-v2'].workflowId}\`\n` +
                    `   💎 Motion Control Output 1080HD\n\n` +
                    `2️⃣ *WAN 2.1 (V5)* ${currentM === 'wan-2.1' ? '✅ (Aktif)' : ''}\n` +
                    `   📌 Workflow ID: \`2001911147597033473\`\n` +
                    `   💎 Wan animate动作迁移 V5\n\n` +
                    `Klik tombol di bawah untuk beralih:`,
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: `🚀 MOTION V2 (1080HD) ${currentM === 'motion-v2' ? '✓' : ''}`, callback_data: 'SET_MODEL_MOTION_V2' }],
                      [{ text: `🌟 WAN 2.1 V5 ${currentM === 'wan-2.1' ? '✓' : ''}`, callback_data: 'SET_MODEL_WAN' }],
                      [{ text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' }],
                    ],
                  },
                  parse_mode: 'Markdown',
                });
                continue;
              }

              // Handle Pool & Keys Commands (Admin only for modifications)
              if (text === '/enterprise' || text === '/panduan' || text === '/helpkey') {
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `🏢 *PANDUAN ENTERPRISE-SHARED API KEY RUNNINGHUB*\n\nRunningHub mewajibkan tipe *Enterprise-Shared API Key* untuk model Motion Control (Wan 2.1 & Kling v3.0).\n\n📌 *Langkah Membuat Enterprise Key di RunningHub:*\n1. Buka [RunningHub.ai](https://www.runninghub.ai) atau [RunningHub.cn](https://www.runninghub.cn)\n2. Masuk ke menu *API Management / OpenAPI*\n3. Pilih tab *Enterprise-Shared API Key* (atau buat API Key di bawah Tim/Enterprise Workspace)\n4. Salin API Key 32-karakter yang dihasilkan\n5. Tambahkan ke Bot dengan mengetik:\n   \`/addkey API_KEY_ANDA\`\n   atau klik tombol *[➕ BULK IMPORT]* untuk memasukkan banyak key sekaligus.\n\n💡 *Tips:* Aktifkan *Auto Rotate* agar bot otomatis beralih jika salah satu key di pool habis kuota!`,
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '➕ Tambah API Key Sekarang', callback_data: 'ADD_KEY_PROMPT' }],
                      [{ text: '📋 Lihat Key Pool', callback_data: 'KEY_POOL' }],
                      [{ text: '🔙 Menu Utama', callback_data: 'MAIN_MENU' }],
                    ],
                  },
                  parse_mode: 'Markdown',
                });
                continue;
              }

              if (text === '/keys' || text === '/pool') {
                if (!isAdmin) {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `ℹ️ RunningHub Key Pool dikelola secara terpusat oleh Admin Server.`,
                  });
                  continue;
                }
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: formatTelegramPoolMessage(),
                  reply_markup: getTelegramPoolInlineKeyboard(),
                  parse_mode: 'Markdown',
                });
                continue;
              }

              if (text === '/bulk' || text === '/bulkimport') {
                if (!isAdmin) {
                  await sendTelegramApi('sendMessage', { chat_id: chatId, text: `⛔ Fitur ini khusus Admin.` });
                  continue;
                }
                session.step = 'awaiting_bulk_file';
                delete session.pendingBulkImport;
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `📄 *Silakan kirim file .txt yang berisi API Key.*\n\n📌 *Format:* 1 API Key per baris.\n_Baris komentar (#) dan spasi otomatis diabaikan._`,
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '❌ BATAL', callback_data: 'BULK_IMPORT_CANCEL' }],
                      [{ text: '📋 Buka Key Pool', callback_data: 'KEY_POOL' }],
                    ],
                  },
                  parse_mode: 'Markdown',
                });
                continue;
              }

              // Check if bulk text input (in awaiting_bulk_file / awaiting_bulk_keys step OR text contains multiline API keys)
              const rawLines = text.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l.length >= 8 && !l.startsWith('/'));
              const isBulkInputStep = session.step === 'awaiting_bulk_file' || session.step === 'awaiting_bulk_keys';
              if (isAdmin && (isBulkInputStep || (rawLines.length >= 2 && !text.startsWith('/')))) {
                const parsed = parseBulkApiKeys(text, 'teks_langsung.txt');

                if (parsed.totalLines === 0 || (parsed.toImportKeys.length === 0 && parsed.fileDuplicates === 0 && parsed.alreadyInPool === 0)) {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `⚠️ *FILE KOSONG*\n\nTidak ditemukan API Key yang dapat diimpor.`,
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '➕ Coba Lagi', callback_data: 'BULK_IMPORT' }],
                        [{ text: '📋 Buka Key Pool', callback_data: 'KEY_POOL' }],
                      ],
                    },
                    parse_mode: 'Markdown',
                  });
                  session.step = 'idle';
                  delete session.pendingBulkImport;
                  continue;
                }

                if (parsed.toImportKeys.length === 0) {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `ℹ️ *TIDAK ADA KEY BARU*\n\nSemua API Key yang dikirim sudah ada di Key Pool atau merupakan duplikat.`,
                    reply_markup: getBulkImportPostKeyboard(),
                    parse_mode: 'Markdown',
                  });
                  session.step = 'idle';
                  delete session.pendingBulkImport;
                  continue;
                }

                // Show PREVIEW
                session.pendingBulkImport = parsed;
                session.step = 'idle';

                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: formatBulkImportPreview(parsed),
                  reply_markup: getBulkImportPreviewKeyboard(),
                  parse_mode: 'Markdown',
                });
                continue;
              }

              if (isAdmin && (text.startsWith('/setworkflow ') || text.startsWith('/wf '))) {
                const newWfId = text.replace('/setworkflow ', '').replace('/wf ', '').trim();
                if (newWfId && newWfId.length >= 5) {
                  activeWorkflowId = newWfId;
                  saveBotConfig();
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `✅ *Workflow ID Diperbarui!*\n\n📌 Active Workflow ID: \`${activeWorkflowId}\`\n\nSemua API Key Normal yang dimasukkan user akan otomatis mengeksekusi Workflow ID ini di RunningHub dengan RH Coins.`,
                    parse_mode: 'Markdown',
                  });
                } else {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `❌ Format Workflow ID tidak valid. Contoh: \`/setworkflow 1894582928503259138\``,
                    parse_mode: 'Markdown',
                  });
                }
                continue;
              }

              if (isAdmin && (text === '/workflow' || text === '/wf')) {
                const currentModel = 'wan-2.1';
                const cfg = EMBEDDED_MOTION_MODELS['wan-2.1'];
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `⚙️ *KONFIGURASI WORKFLOW WAN 2.1 (RUNNINGHUB)*\n\n🌟 *WAN 2.1 MOTION CONTROL (Alibaba)*\n• Active Workflow ID: \`${cfg.workflowId}\`\n• 🖼️ Node Foto ID: \`${cfg.imageNodeId}\`\n• 🎥 Node Video ID: \`${cfg.videoNodeId}\`\n• Extra Nodes: Resolution 720p/1280, 30fps, quality prompt\n• Status: 100% Verified di RunningHub AI App\n\n_Anda cukup memasukkan API Key dan langsung generate tanpa perlu setting manual lagi._`,
                  parse_mode: 'Markdown',
                });
                continue;
              }

              if (isAdmin && text.startsWith('/setnodes ')) {
                const parts = text.replace('/setnodes ', '').trim().split(/\s+/);
                if (parts.length >= 2) {
                  imageNodeId = parts[0].replace(/[^a-zA-Z0-9_-]/g, '');
                  videoNodeId = parts[1].replace(/[^a-zA-Z0-9_-]/g, '');
                  saveBotConfig();
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `✅ *Node ID Diperbarui!*\n\n🖼️ Node Foto: \`${imageNodeId}\`\n🎥 Node Video: \`${videoNodeId}\``,
                    parse_mode: 'Markdown',
                  });
                } else {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `❌ Contoh penggunaan: \`/setnodes 1 2\``,
                    parse_mode: 'Markdown',
                  });
                }
                continue;
              }

              if (isAdmin && text === '/autorotate') {
                autoRotateEnabled = !autoRotateEnabled;
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `🔄 Auto Rotate sekarang: *${autoRotateEnabled ? '🟢 AKTIF' : '🔴 NONAKTIF'}*\n\n${formatTelegramPoolMessage()}`,
                  reply_markup: getTelegramPoolInlineKeyboard(),
                  parse_mode: 'Markdown',
                });
                continue;
              }

              if (isAdmin && (text === '/clearkeys' || text === '/hapussemua' || text === '/clearall' || text === '/delall' || text === '/hapusall' || text === '/clear')) {
                const count = apiKeyPool.length;
                apiKeyPool.forEach((item) => {
                  if (item.key && !deletedKeysList.includes(item.key)) {
                    deletedKeysList.push(item.key);
                  }
                });
                saveDeletedKeys();
                apiKeyPool = [];
                saveApiKeyPoolToFile();
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `🗑️ *Seluruh ${count} API Key di Pool telah dihapus bersih!*\n\n${formatTelegramPoolMessage()}`,
                  reply_markup: getTelegramPoolInlineKeyboard(),
                  parse_mode: 'Markdown',
                });
                continue;
              }

              if (isAdmin && text === '/clearfailed') {
                const before = apiKeyPool.length;
                const failedKeys = apiKeyPool.filter((k) => k.status !== 'enterprise' && k.status !== 'unverified');
                failedKeys.forEach((item) => {
                  if (item.key && !deletedKeysList.includes(item.key)) {
                    deletedKeysList.push(item.key);
                  }
                });
                saveDeletedKeys();
                apiKeyPool = apiKeyPool.filter((k) => k.status === 'enterprise' || k.status === 'unverified');
                const removed = before - apiKeyPool.length;
                saveApiKeyPoolToFile();
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `🗑️ Berhasil menghapus ${removed} key yang gagal / non-Enterprise-Shared!\n\n${formatTelegramPoolMessage()}`,
                  reply_markup: getTelegramPoolInlineKeyboard(),
                  parse_mode: 'Markdown',
                });
                continue;
              }

              if (isAdmin && (text === '/verify' || text === '/cekkey' || text === '/verifikasi')) {
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `⏳ *Memverifikasi ${apiKeyPool.length} API Key di Pool...*`,
                  parse_mode: 'Markdown',
                });
                for (let i = 0; i < apiKeyPool.length; i++) {
                  await verifyApiKeyItem(apiKeyPool[i]);
                }
                saveApiKeyPoolToFile();
                await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `✅ *Verifikasi Selesai!*\n\n${formatTelegramPoolMessage()}`,
                  reply_markup: getTelegramPoolInlineKeyboard(),
                  parse_mode: 'Markdown',
                });
                continue;
              }

              if (isAdmin && (text === '/delkey' || text === '/hapuskey' || text.startsWith('/delkey ') || text.startsWith('/hapuskey '))) {
                const rawArg = text.replace('/delkey', '').replace('/hapuskey', '').trim();

                if (!rawArg) {
                  // If just /delkey without arguments, show paginated delete keys menu
                  const view = formatDeleteKeysPage(0);
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: view.text,
                    reply_markup: { inline_keyboard: view.keyboard },
                    parse_mode: 'Markdown',
                  });
                  continue;
                }

                if (rawArg.toLowerCase() === 'all' || rawArg.toLowerCase() === 'semua' || rawArg === '*') {
                  const count = apiKeyPool.length;
                  apiKeyPool.forEach((item) => {
                    if (item.key && !deletedKeysList.includes(item.key)) {
                      deletedKeysList.push(item.key);
                    }
                  });
                  saveDeletedKeys();
                  apiKeyPool = [];
                  saveApiKeyPoolToFile();
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `🗑️ *Seluruh ${count} API Key di Pool telah dihapus bersih!*\n\n${formatTelegramPoolMessage()}`,
                    reply_markup: getTelegramPoolInlineKeyboard(),
                    parse_mode: 'Markdown',
                  });
                  continue;
                }

                // Support comma-separated or space-separated list of numbers e.g. "1 2 3" or "1,2,3"
                const tokens = rawArg.split(/[\s,]+/).filter(Boolean);
                const deletedKeys: string[] = [];

                // Collect indices in descending order so removal doesn't shift remaining indices
                const indicesToDelete: number[] = [];
                for (const t of tokens) {
                  const num = parseInt(t, 10);
                  if (!isNaN(num) && num >= 1 && num <= apiKeyPool.length) {
                    if (!indicesToDelete.includes(num - 1)) {
                      indicesToDelete.push(num - 1);
                    }
                  } else {
                    // Check if matching key string or ID
                    const foundIdx = apiKeyPool.findIndex((k) => k.key === t || k.id === t || k.key.endsWith(t));
                    if (foundIdx >= 0 && !indicesToDelete.includes(foundIdx)) {
                      indicesToDelete.push(foundIdx);
                    }
                  }
                }

                indicesToDelete.sort((a, b) => b - a); // descending
                indicesToDelete.forEach((idx) => {
                  const [item] = apiKeyPool.splice(idx, 1);
                  if (item) {
                    if (item.key && !deletedKeysList.includes(item.key)) {
                      deletedKeysList.push(item.key);
                    }
                    deletedKeys.push(maskKey(item.key));
                  }
                });

                if (deletedKeys.length > 0) {
                  saveDeletedKeys();
                  saveApiKeyPoolToFile();
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `🗑️ *Berhasil Menghapus ${deletedKeys.length} API Key:*\n${deletedKeys.map((k) => `• \`${k}\``).join('\n')}\n\n${formatTelegramPoolMessage()}`,
                    reply_markup: getTelegramPoolInlineKeyboard(),
                    parse_mode: 'Markdown',
                  });
                } else {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `❌ Nomor urut atau key tidak ditemukan.\n\n💡 *Contoh:* \`/delkey 1\` atau \`/delkey 1 2 3\` atau \`/delkey all\``,
                    parse_mode: 'Markdown',
                  });
                }
                continue;
              }

              // Handle Direct API Key Input (Admin guarded - supports /addkey, /key, awaiting_key, or direct 32-char key pasting)
              const cleanTextKey = text.trim();
              const isDirectKeyFormat = /^[a-fA-F0-9]{32}$/.test(cleanTextKey) || (/^[a-zA-Z0-9_-]{24,64}$/.test(cleanTextKey) && !cleanTextKey.startsWith('/'));
              const isAddKeyCmd = text.startsWith('/key ') || text.startsWith('/addkey ') || text.startsWith('/tambahkey ');
              const isAwaitingKeyStep = session.step === 'awaiting_key';

              if (isAdmin && (isAddKeyCmd || isAwaitingKeyStep || isDirectKeyFormat)) {
                let newKey = cleanTextKey.replace(/^["']|["']$/g, '').replace(/^(api_?key[:=]\s*)/i, '').trim();
                if (isAddKeyCmd) {
                  newKey = text.replace('/key ', '').replace('/addkey ', '').replace('/tambahkey ', '').trim().replace(/^["']|["']$/g, '').replace(/^(api_?key[:=]\s*)/i, '').trim();
                }

                session.step = 'idle';

                if (!newKey || newKey.length < 8) {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `❌ API Key tidak valid. Masukkan 32-character RunningHub API Key.`,
                  });
                  continue;
                }

                // Un-blacklist if previously deleted
                if (deletedKeysList.includes(newKey)) {
                  deletedKeysList = deletedKeysList.filter((k) => k !== newKey);
                  saveDeletedKeys();
                }

                session.userApiKey = newKey;

                // Check if already in pool
                let existingItem = apiKeyPool.find((k) => k.key === newKey);
                if (!existingItem) {
                  existingItem = {
                    id: `key-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                    key: newKey,
                    status: 'unverified',
                    statusLabel: getStatusLabel('unverified'),
                    addedAt: new Date().toISOString(),
                  };
                  apiKeyPool.unshift(existingItem);
                }

                const testMsg = await sendTelegramApi('sendMessage', {
                  chat_id: chatId,
                  text: `⏳ *Memverifikasi API Key langsung...*\nKey: \`${maskKey(newKey)}\`\nStatus: 🟡 Belum diverifikasi`,
                  parse_mode: 'Markdown',
                });

                // Run verification
                await verifyApiKeyItem(existingItem);
                saveApiKeyPoolToFile();

                const successMsg = `✅ *API Key Berhasil Ditambahkan Langsung!*\n\n🔑 Key: \`${maskKey(newKey)}\`\n📊 Status: ${existingItem.statusLabel}\n\n${formatTelegramPoolMessage()}`;
                const replyKbd = getTelegramPoolInlineKeyboard();

                if (testMsg?.ok && testMsg?.result?.message_id) {
                  await sendTelegramApi('editMessageText', {
                    chat_id: chatId,
                    message_id: testMsg.result.message_id,
                    text: successMsg,
                    reply_markup: replyKbd,
                    parse_mode: 'Markdown',
                  });
                } else {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: successMsg,
                    reply_markup: replyKbd,
                    parse_mode: 'Markdown',
                  });
                }
                continue;
              }

              // Intelligent Media Classification (Photos vs Videos vs Documents)
              const hasPhoto = Boolean(msg.photo && msg.photo.length > 0);
              const docMime = msg.document?.mime_type?.toLowerCase() || '';
              const docName = msg.document?.file_name?.toLowerCase() || '';
              const isDocImage = Boolean(
                msg.document &&
                (docMime.startsWith('image/') || /\.(jpg|jpeg|png|webp|bmp|gif)$/i.test(docName))
              );
              const hasVideo = Boolean(msg.video);
              const isDocVideo = Boolean(
                msg.document &&
                (docMime.startsWith('video/') || /\.(mp4|mov|avi|webm|mkv|3gp)$/i.test(docName))
              );

              // Handle Admin Broadcast Message Input Step
              if (isAdmin && session.step === 'awaiting_broadcast_message') {
                if (text === '/cancel' || text === '/batal') {
                  session.step = 'idle';
                  delete session.broadcastPayload;
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `❌ *PROSES BROADCAST DIBATALKAN*`,
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '📢 Buka Panel Pemberitahuan', callback_data: 'ADMIN_BROADCAST_START' }],
                        [{ text: '👑 Panel Admin', callback_data: 'ADMIN_PANEL' }],
                      ],
                    },
                    parse_mode: 'Markdown',
                  });
                  continue;
                }

                let payloadType: 'text' | 'photo' | 'video' | 'document' = 'text';
                let mediaFileId: string | undefined = undefined;
                let contentText = msg.caption?.trim() || msg.text?.trim() || '';

                if (msg.photo && msg.photo.length > 0) {
                  payloadType = 'photo';
                  mediaFileId = msg.photo[msg.photo.length - 1].file_id;
                } else if (msg.video) {
                  payloadType = 'video';
                  mediaFileId = msg.video.file_id;
                } else if (msg.document) {
                  payloadType = 'document';
                  mediaFileId = msg.document.file_id;
                }

                if (!contentText && !mediaFileId) {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `⚠️ *Pesan broadcast tidak boleh kosong.*\n\nSilakan kirim teks, foto, video, atau dokumen dengan keterangan.`,
                    parse_mode: 'Markdown',
                  });
                  continue;
                }

                session.broadcastPayload = {
                  type: payloadType,
                  fileId: mediaFileId,
                  text: contentText,
                  caption: contentText,
                };
                session.step = 'awaiting_broadcast_confirm';

                const activeTargetCount = botUsers.filter((u) => u.status === 'active' && u.id !== SOLE_ADMIN_ID).length;
                const previewText = `📢 *PREVIEW PESAN PEMBERITAHUAN (BROADCAST)*\n\n` +
                  `🎯 *Target Penerima:* ${activeTargetCount} Member Terdaftar\n` +
                  `📦 *Tipe Pesan:* ${payloadType.toUpperCase()}\n\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━\n` +
                  `${contentText || '_(Tanpa Keterangan Teks)_'}\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                  `Apakah Anda yakin ingin mengirimkan pesan pengumuman ini ke **SEMUA ${activeTargetCount} MEMBER** sekarang?`;

                const inlineKbd = [
                  [{ text: '🚀 YA, KIRIM KE SEMUA MEMBER NOW', callback_data: 'ADMIN_BROADCAST_CONFIRM' }],
                  [{ text: '✏️ Edit / Tulis Ulang', callback_data: 'ADMIN_BROADCAST_START' }],
                  [{ text: '❌ BATAL', callback_data: 'ADMIN_BROADCAST_CANCEL' }],
                ];

                if (payloadType === 'photo' && mediaFileId) {
                  await sendTelegramApi('sendPhoto', {
                    chat_id: chatId,
                    photo: mediaFileId,
                    caption: previewText,
                    reply_markup: { inline_keyboard: inlineKbd },
                    parse_mode: 'Markdown',
                  });
                } else if (payloadType === 'video' && mediaFileId) {
                  await sendTelegramApi('sendVideo', {
                    chat_id: chatId,
                    video: mediaFileId,
                    caption: previewText,
                    reply_markup: { inline_keyboard: inlineKbd },
                    parse_mode: 'Markdown',
                  });
                } else if (payloadType === 'document' && mediaFileId) {
                  await sendTelegramApi('sendDocument', {
                    chat_id: chatId,
                    document: mediaFileId,
                    caption: previewText,
                    reply_markup: { inline_keyboard: inlineKbd },
                    parse_mode: 'Markdown',
                  });
                } else {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: previewText,
                    reply_markup: { inline_keyboard: inlineKbd },
                    parse_mode: 'Markdown',
                  });
                }
                continue;
              }

              // 0. Handle Bulk Import Document (.txt File)
              if (msg.document && !isDocImage && !isDocVideo) {
                const isTxtFile = docName.endsWith('.txt') || docMime === 'text/plain';
                const isBulkStep = session.step === 'awaiting_bulk_file' || session.step === 'awaiting_bulk_keys';

                if (isBulkStep || (isAdmin && isTxtFile)) {
                  if (!isAdmin) {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `⛔ Fitur ini khusus Admin.`,
                    });
                    continue;
                  }

                  if (!isTxtFile) {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `❌ *FORMAT FILE TIDAK DIDUKUNG*\n\nSilakan kirim file *.txt* yang berisi 1 API Key per baris.`,
                      reply_markup: {
                        inline_keyboard: [
                          [{ text: '❌ BATAL', callback_data: 'BULK_IMPORT_CANCEL' }],
                          [{ text: '📋 Buka Key Pool', callback_data: 'KEY_POOL' }],
                        ],
                      },
                      parse_mode: 'Markdown',
                    });
                    continue;
                  }

                  // Download file
                  const fileUrl = await getTelegramFileUrl(msg.document.file_id);
                  if (!fileUrl) {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `❌ Gagal mengunduh file dari Telegram. Silakan coba kirim ulang file Anda.`,
                    });
                    continue;
                  }

                  try {
                    const fileRes = await fetch(fileUrl);
                    const fileText = await fileRes.text();
                    const parsed = parseBulkApiKeys(fileText, msg.document.file_name || 'keys.txt');

                    if (parsed.totalLines === 0 || (parsed.toImportKeys.length === 0 && parsed.fileDuplicates === 0 && parsed.alreadyInPool === 0)) {
                      await sendTelegramApi('sendMessage', {
                        chat_id: chatId,
                        text: `⚠️ *FILE KOSONG*\n\nTidak ditemukan API Key yang dapat diimpor.`,
                        reply_markup: {
                          inline_keyboard: [
                            [{ text: '➕ Coba Lagi', callback_data: 'BULK_IMPORT' }],
                            [{ text: '📋 Buka Key Pool', callback_data: 'KEY_POOL' }],
                          ],
                        },
                        parse_mode: 'Markdown',
                      });
                      session.step = 'idle';
                      delete session.pendingBulkImport;
                      continue;
                    }

                    if (parsed.toImportKeys.length === 0) {
                      await sendTelegramApi('sendMessage', {
                        chat_id: chatId,
                        text: `ℹ️ *TIDAK ADA KEY BARU*\n\nSemua API Key dari file sudah ada di Key Pool atau merupakan duplikat.`,
                        reply_markup: getBulkImportPostKeyboard(),
                        parse_mode: 'Markdown',
                      });
                      session.step = 'idle';
                      delete session.pendingBulkImport;
                      continue;
                    }

                    session.pendingBulkImport = parsed;
                    session.step = 'idle';
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: formatBulkImportPreview(parsed),
                      reply_markup: getBulkImportPreviewKeyboard(),
                      parse_mode: 'Markdown',
                    });
                    continue;
                  } catch (docErr: any) {
                    console.error('[Bulk Import Document Error]', docErr);
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `❌ Gagal memproses file: ${docErr.message}`,
                    });
                    continue;
                  }
                }
              }

              // 1. Handle Photo Upload (Standard Photo or Image Document)
              if (hasPhoto || isDocImage || (msg.document && session.step === 'awaiting_photo' && !isDocVideo)) {
                if (!isAdmin && getMemberActiveCount(chatId) >= 2) {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: PARALLEL_LIMIT_REJECTION_TEXT,
                    parse_mode: 'Markdown',
                  });
                  continue;
                }

                const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document?.file_id;
                if (fileId) {
                  const photoUrl = await getTelegramFileUrl(fileId);
                  if (photoUrl) {
                    session.imageUrl = photoUrl;
                    if (msg.caption?.trim()) {
                      session.prompt = msg.caption.trim();
                    }

                    if (session.videoUrl) {
                      // Both photo and video are now available -> Start generating!
                      await sendTelegramApi('sendMessage', {
                        chat_id: chatId,
                        text: `✅ *Foto Karakter Berhasil Diterima!* 📸\n\nVideo gerakan juga sudah siap. Memulai generate video sekarang... 🚀`,
                        parse_mode: 'Markdown',
                      });
                      processTelegramMotionControlTask(chatId, session).catch((err) =>
                        console.error('[Telegram Task Async Error]', err)
                      );
                    } else {
                      session.step = 'awaiting_video';
                      await sendTelegramApi('sendMessage', {
                        chat_id: chatId,
                        text: `✅ *Foto Karakter Berhasil Diterima!* 📸\n\n🎥 *Langkah 2/2: Kirim Video Gerakan*\nSekarang kirimkan video gerakan (file video, dokumen MP4, atau URL video) yang ingin ditiru oleh karakter Anda.\n\n💡 *Tips:* Durasi video 3–30 detik. Ketik \`/batal\` jika ingin mengganti foto.`,
                        parse_mode: 'Markdown',
                      });
                    }
                  } else {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `❌ Gagal mengunduh foto dari Telegram. Silakan coba kirim ulang foto Anda.`,
                    });
                  }
                }
                continue;
              }

              // 2. Handle Video Upload (Standard Video or Video Document)
              if (hasVideo || isDocVideo || (msg.document && session.step === 'awaiting_video' && !isDocImage)) {
                if (!isAdmin && getMemberActiveCount(chatId) >= 2) {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: PARALLEL_LIMIT_REJECTION_TEXT,
                    parse_mode: 'Markdown',
                  });
                  continue;
                }

                const fileId = msg.video?.file_id || msg.document?.file_id;
                if (fileId) {
                  const videoUrl = await getTelegramFileUrl(fileId);
                  if (videoUrl) {
                    session.videoUrl = videoUrl;
                    if (msg.caption?.trim() && !session.prompt) {
                      session.prompt = msg.caption.trim();
                    }

                    if (!session.imageUrl) {
                      session.step = 'awaiting_photo';
                      await sendTelegramApi('sendMessage', {
                        chat_id: chatId,
                        text: `⚠️ *Foto Karakter Belum Dikirim!* 📸\n\nVideo gerakan berhasil diterima, namun bot membutuhkan *1 foto karakter/orang* Anda agar hasil video sesuai dengan wajah dan karakter yang Anda inginkan.\n\n👉 *Silakan kirimkan 1 foto karakter Anda sekarang!*`,
                        parse_mode: 'Markdown',
                      });
                    } else {
                      // Both photo and video are ready -> proceed to generate
                      processTelegramMotionControlTask(chatId, session).catch((err) =>
                        console.error('[Telegram Task Async Error]', err)
                      );
                    }
                  } else {
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `❌ Gagal mengunduh video dari Telegram. Silakan coba kirim ulang.`,
                    });
                  }
                }
                continue;
              }

              // 3. Fallback URL and text inputs
              if (session.step === 'awaiting_photo') {
                if (!isAdmin && getMemberActiveCount(chatId) >= 2) {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: PARALLEL_LIMIT_REJECTION_TEXT,
                    parse_mode: 'Markdown',
                  });
                  continue;
                }

                if (text.startsWith('http')) {
                  session.imageUrl = text;
                  if (session.videoUrl) {
                    processTelegramMotionControlTask(chatId, session).catch((err) =>
                      console.error('[Telegram Task Async Error]', err)
                    );
                  } else {
                    session.step = 'awaiting_video';
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `✅ *Foto URL diterima.* 📸\n\n🎥 *Langkah 2/2*\nSekarang kirimkan video gerakan (file MP4 atau link video).`,
                      parse_mode: 'Markdown',
                    });
                  }
                } else {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `📸 *Langkah 1/2*\nSilakan kirim file foto karakter Anda (atau tempel URL foto).\nKetik \`/batal\` jika ingin membatalkan.`,
                    parse_mode: 'Markdown',
                  });
                }
              } else if (session.step === 'awaiting_video') {
                if (!isAdmin && getMemberActiveCount(chatId) >= 2) {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: PARALLEL_LIMIT_REJECTION_TEXT,
                    parse_mode: 'Markdown',
                  });
                  continue;
                }
                if (text.startsWith('http')) {
                  session.videoUrl = text;
                  if (!session.imageUrl) {
                    session.step = 'awaiting_photo';
                    await sendTelegramApi('sendMessage', {
                      chat_id: chatId,
                      text: `⚠️ Mohon kirimkan foto karakter terlebih dahulu.`,
                    });
                  } else {
                    processTelegramMotionControlTask(chatId, session).catch((err) =>
                      console.error('[Telegram Task Async Error]', err)
                    );
                  }
                } else {
                  await sendTelegramApi('sendMessage', {
                    chat_id: chatId,
                    text: `🎥 *Langkah 2/2*\nSilakan kirim file video gerakan Anda (atau tempel URL video MP4).\nKetik \`/batal\` jika ingin mengganti foto karakter.`,
                    parse_mode: 'Markdown',
                  });
                }
              } else {
                await sendWelcomeMenu(chatId);
              }
            }
          }
        }
      } catch (err) {
        console.error('[Telegram Polling Loop Exception]', err);
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  })();
}

// Helper to parse and normalize any RunningHub task query response format
export interface NormalizedTaskQuery {
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  taskId: string;
  results: Array<{ url: string; outputType?: string; nodeId?: string }>;
  videoUrl?: string;
  errorMessage?: string;
  errorCode?: string;
  taskCostTime?: string;
  raw: any;
}

function parseAndNormalizeTaskResult(data: any, fallbackTaskId: string): NormalizedTaskQuery {
  if (!data) {
    return {
      status: 'RUNNING',
      taskId: fallbackTaskId,
      results: [],
      raw: data,
    };
  }

  const taskId = data.taskId || data.data?.taskId || data.data?.task_id || fallbackTaskId;
  const results: Array<{ url: string; outputType?: string; nodeId?: string }> = [];
  let videoUrl: string | undefined = undefined;

  const rawResults =
    data.results ||
    data.data?.results ||
    data.outputs ||
    data.data?.outputs ||
    (Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []);

  if (Array.isArray(rawResults)) {
    for (const item of rawResults) {
      if (typeof item === 'string' && item.startsWith('http')) {
        results.push({ url: item, outputType: 'video' });
      } else if (item && typeof item === 'object') {
        const u =
          item.url ||
          item.fileUrl ||
          item.outputUrl ||
          item.download_url ||
          item.videoUrl ||
          item.src;
        if (u && typeof u === 'string') {
          results.push({
            url: u,
            outputType: item.outputType || item.fileType || 'video',
            nodeId: item.nodeId ? String(item.nodeId) : undefined,
          });
        }
      }
    }
  }

  // Helper scoring function to guarantee picking the FINAL rendered character video over intermediate pose skeletons
  const scoreOutput = (resItem: { url: string; outputType?: string; nodeId?: string }) => {
    const urlLower = (resItem.url || '').toLowerCase();
    const nodeIdStr = String(resItem.nodeId || '');
    let score = 10;

    // 1. High bonus for known final render indicators
    if (
      urlLower.includes('wan-animate') ||
      urlLower.includes('wan2') ||
      urlLower.includes('kling') ||
      urlLower.includes('combine') ||
      urlLower.includes('final') ||
      urlLower.includes('output') ||
      urlLower.includes('render') ||
      urlLower.includes('vhs')
    ) {
      score += 50;
    }

    // 2. High bonus for primary output node (Node 24 in Wan animate workflow)
    if (nodeIdStr === '24') {
      score += 100;
    }

    // 3. Heavy penalty for intermediate OpenPose / skeleton stickman nodes (Node 132 / AnimateDiff / DWPose)
    if (
      nodeIdStr === '132' ||
      urlLower.includes('animatediff') ||
      urlLower.includes('openpose') ||
      urlLower.includes('dwpose') ||
      urlLower.includes('skeleton') ||
      urlLower.includes('stickman') ||
      urlLower.includes('pose') ||
      urlLower.includes('preview') ||
      urlLower.includes('mask') ||
      urlLower.includes('canny') ||
      urlLower.includes('depth')
    ) {
      score -= 80;
    }

    return score;
  };

  // Sort results by score descending so that best final video is at index 0
  if (results.length > 0) {
    results.sort((a, b) => scoreOutput(b) - scoreOutput(a));
    videoUrl = results[0].url;
  }

  if (!videoUrl) {
    const directUrl =
      data.url ||
      data.fileUrl ||
      data.download_url ||
      data.videoUrl ||
      data.outputUrl ||
      data.data?.url ||
      data.data?.fileUrl ||
      data.data?.download_url ||
      data.data?.videoUrl ||
      data.data?.outputUrl;
    if (directUrl && typeof directUrl === 'string' && directUrl.startsWith('http')) {
      results.push({ url: directUrl, outputType: 'video' });
      videoUrl = directUrl;
    }
  }

  const rawStatus = String(
    data.status ||
    data.data?.status ||
    data.taskStatus ||
    data.data?.taskStatus ||
    (data.code === 0 && videoUrl ? 'SUCCESS' : '')
  ).toUpperCase();

  const errorCode =
    data.errorCode ||
    data.data?.errorCode ||
    (data.code !== undefined && data.code !== 0 && data.code !== 200 ? String(data.code) : undefined);

  const failedObj = data.failedReason || data.data?.failedReason;
  const exceptionMsg =
    typeof failedObj === 'object' && failedObj
      ? failedObj.exception_message || failedObj.message || failedObj.error || (failedObj.node_name ? `Node ${failedObj.node_name}: ${failedObj.exception_type || 'Error'}` : undefined)
      : undefined;

  const errorMessage =
    exceptionMsg ||
    data.errorMessage ||
    data.data?.errorMessage ||
    data.message ||
    data.msg;

  let status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' = 'RUNNING';

  // 1. Success checks (Code 0 with outputs, or explicit success status)
  if (
    rawStatus === 'SUCCESS' ||
    rawStatus === 'COMPLETED' ||
    rawStatus === 'FINISHED' ||
    rawStatus === 'DONE' ||
    (data.code === 0 && (videoUrl || results.length > 0)) ||
    videoUrl
  ) {
    status = 'SUCCESS';
  } else if (
    failedObj ||
    data.msg === 'APIKEY_TASK_STATUS_ERROR' ||
    rawStatus === 'FAILED' ||
    rawStatus === 'FAILURE' ||
    rawStatus === 'ERROR' ||
    (data.code !== undefined && data.code !== 0 && data.code !== 804 && data.code !== 805 && data.code !== 200 && !videoUrl)
  ) {
    status = 'FAILED';
  } else if (
    (data.code === 805 && data.msg === 'APIKEY_TASK_IN_QUEUE') ||
    rawStatus === 'QUEUED' ||
    rawStatus === 'PENDING' ||
    rawStatus === 'WAITING'
  ) {
    status = 'QUEUED';
  } else if (
    data.code === 804 ||
    data.msg === 'APIKEY_TASK_IS_RUNNING' ||
    rawStatus === 'RUNNING' ||
    rawStatus === 'PROCESSING' ||
    rawStatus === 'GENERATING'
  ) {
    status = 'RUNNING';
  } else {
    status = 'RUNNING';
  }

  const taskCostTime =
    data.usage?.taskCostTime ||
    data.data?.usage?.taskCostTime ||
    data.taskCostTime ||
    data.data?.taskCostTime;

  return {
    status,
    taskId,
    results,
    videoUrl,
    errorMessage: errorMessage || (status === 'FAILED' ? (data.msg || 'Task execution failed') : undefined),
    errorCode,
    taskCostTime: taskCostTime ? String(taskCostTime) : undefined,
    raw: data,
  };
}

// Multi-endpoint task query runner with fast 4s timeout & early return
async function queryRunningHubTask(taskId: string, apiKey: string): Promise<NormalizedTaskQuery> {
  const queryEndpoints = [
    {
      url: 'https://www.runninghub.ai/task/openapi/outputs',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ apiKey, taskId }),
    },
    {
      url: 'https://www.runninghub.ai/openapi/v2/query',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'apikey': apiKey,
      },
      body: JSON.stringify({ apiKey, taskId }),
    },
    {
      url: 'https://www.runninghub.cn/task/openapi/outputs',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ apiKey, taskId }),
    },
  ];

  let lastParsed: NormalizedTaskQuery = {
    status: 'RUNNING',
    taskId,
    results: [],
    raw: null,
  };

  for (const ep of queryEndpoints) {
    try {
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: ep.headers,
        body: ep.body,
        signal: AbortSignal.timeout(4000),
      });

      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        const parsed = parseAndNormalizeTaskResult(data, taskId);
        return parsed;
      }
    } catch (e: any) {
      // Endpoint fallback silently
    }
  }

  return lastParsed;
}

// Public Base URL for webhook and hosted media callbacks
const PUBLIC_BASE_URL =
  process.env.APP_URL ||
  process.env.RENDER_EXTERNAL_HOSTNAME ||
  'https://ais-dev-sly5riwg74spreblqvg75j-653164865491.asia-southeast1.run.app';

// Helper to re-upload Telegram media or external media directly to RunningHub OpenAPI storage or global CDN
async function uploadTelegramMediaToRunningHub(mediaUrl: string, apiKey: string, defaultFilename: string): Promise<string> {
  if (!mediaUrl) return mediaUrl;
  
  // If it's already an internal RunningHub filename reference or file URL, return it directly
  if (
    mediaUrl.startsWith('api/') ||
    mediaUrl.startsWith('personal/') ||
    mediaUrl.includes('file.runninghub.ai') ||
    mediaUrl.includes('rh-hk-images') ||
    mediaUrl.includes('myfj.runninghub')
  ) {
    return mediaUrl;
  }

  let buffer: Buffer | null = null;
  let contentType = 'application/octet-stream';
  const isVideo = defaultFilename.toLowerCase().endsWith('.mp4') || defaultFilename.toLowerCase().endsWith('.mov') || defaultFilename.toLowerCase().endsWith('.webm');
  const fileTypeParam = isVideo ? 'video' : 'image';

  try {
    console.log(`[RunningHub Media Upload] Fetching binary media from ${mediaUrl.slice(0, 100)}...`);
    const mediaRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(12000) });
    if (mediaRes.ok) {
      const arrBuf = await mediaRes.arrayBuffer();
      buffer = Buffer.from(arrBuf);
      contentType = mediaRes.headers.get('content-type') || (isVideo ? 'video/mp4' : 'image/jpeg');
    }
  } catch (downloadErr: any) {
    console.warn(`[RunningHub Media Upload] Failed to fetch media from ${mediaUrl}:`, downloadErr.message);
  }

  if (buffer && buffer.length > 0) {
    // 1. Primary Strategy: Upload directly to RunningHub OpenAPI (/task/openapi/upload)
    const poolKeys = apiKeyPool.map((item) => (typeof item === 'string' ? item : item?.key));
    const candidateKeys = [apiKey, ...poolKeys].filter((k): k is string => Boolean(k && typeof k === 'string' && k.trim().length > 8));
    const uniqueKeys = Array.from(new Set(candidateKeys)).slice(0, 3); // Test top 3 valid keys max

    const uploadEndpoints = [
      'https://www.runninghub.ai/task/openapi/upload',
      'https://www.runninghub.cn/task/openapi/upload',
    ];

    for (const testKey of uniqueKeys) {
      for (const endpoint of uploadEndpoints) {
        try {
          const formData = new FormData();
          formData.append('apiKey', testKey);
          formData.append('fileType', fileTypeParam);
          const blob = new Blob([buffer], { type: contentType });
          formData.append('file', blob, defaultFilename);

          const fullEndpointUrl = `${endpoint}?apiKey=${encodeURIComponent(testKey)}`;
          const rhRes = await fetch(fullEndpointUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${testKey}`,
              'apikey': testKey,
            },
            body: formData,
            signal: AbortSignal.timeout(10000),
          });

          const rhData = await rhRes.json().catch(() => null);
          if (rhData && (rhData.code === 0 || rhData.code === 200 || rhData.status === 'success') && rhData.data) {
            let fileName = '';
            if (typeof rhData.data === 'string') {
              fileName = rhData.data.trim();
            } else if (typeof rhData.data === 'object') {
              fileName = (rhData.data.fileName || rhData.data.url || rhData.data.fileUrl || rhData.data.path || rhData.data.download_url || '') as string;
            }
            if (fileName && typeof fileName === 'string' && fileName.length > 3) {
              console.log(`[RunningHub Media Upload] ✅ Successfully uploaded ${defaultFilename} to RunningHub (Key: ${testKey.slice(0, 6)}...): ${fileName}`);
              return fileName;
            }
          } else {
            console.warn(`[RunningHub Media Upload] Endpoint ${endpoint} returned non-zero code:`, rhData);
          }
        } catch (uploadErr: any) {
          console.warn(`[RunningHub Media Upload] Attempt failed on ${endpoint} with key ${testKey.slice(0, 6)}:`, uploadErr.message);
        }
      }
    }

    // 2. Secondary fallback: Litterbox CDN (72h temporary storage up to 1GB - fast & no auth restrictions)
    try {
      console.log(`[RunningHub Media Upload] Fallback 1: Uploading ${defaultFilename} to Litterbox CDN...`);
      const litterForm = new FormData();
      const blob = new Blob([buffer], { type: contentType });
      litterForm.append('reqtype', 'fileupload');
      litterForm.append('time', '72h');
      litterForm.append('fileToUpload', blob, defaultFilename);

      const litterRes = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
        method: 'POST',
        body: litterForm,
        signal: AbortSignal.timeout(15000),
      });

      if (litterRes.ok) {
        const litterUrl = (await litterRes.text()).trim();
        if (litterUrl.startsWith('http')) {
          console.log(`[RunningHub Media Upload] ✅ Uploaded to Litterbox: ${litterUrl}`);
          return litterUrl;
        }
      }
    } catch (litterErr: any) {
      console.warn(`[RunningHub Media Upload] Litterbox fallback failed:`, litterErr.message);
    }

    // 3. Third fallback: Catbox CDN
    try {
      console.log(`[RunningHub Media Upload] Fallback 2: Uploading ${defaultFilename} to Catbox CDN...`);
      const catboxForm = new FormData();
      const blob = new Blob([buffer], { type: contentType });
      catboxForm.append('reqtype', 'fileupload');
      catboxForm.append('fileToUpload', blob, defaultFilename);

      const catboxRes = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: catboxForm,
        signal: AbortSignal.timeout(15000),
      });

      if (catboxRes.ok) {
        const catboxUrl = (await catboxRes.text()).trim();
        if (catboxUrl.startsWith('http')) {
          console.log(`[RunningHub Media Upload] ✅ Uploaded to Catbox: ${catboxUrl}`);
          return catboxUrl;
        }
      }
    } catch (catboxErr: any) {
      console.warn(`[RunningHub Media Upload] Catbox fallback failed:`, catboxErr.message);
    }

    // 4. Fourth fallback: Tmpfiles CDN
    try {
      console.log(`[RunningHub Media Upload] Fallback 3: Uploading ${defaultFilename} to Tmpfiles CDN...`);
      const tmpForm = new FormData();
      const blob = new Blob([buffer], { type: contentType });
      tmpForm.append('file', blob, defaultFilename);

      const tmpRes = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: tmpForm,
        signal: AbortSignal.timeout(12000),
      });

      if (tmpRes.ok) {
        const tmpData = await tmpRes.json().catch(() => null);
        if (tmpData && tmpData.status === 'success' && tmpData.data?.url) {
          // Direct download link format: https://tmpfiles.org/dl/123456/filename.mp4
          const directUrl = (tmpData.data.url as string).replace('tmpfiles.org/', 'tmpfiles.org/dl/');
          console.log(`[RunningHub Media Upload] ✅ Uploaded to Tmpfiles: ${directUrl}`);
          return directUrl;
        }
      }
    } catch (tmpErr: any) {
      console.warn(`[RunningHub Media Upload] Tmpfiles fallback failed:`, tmpErr.message);
    }

    // 5. Fifth fallback for images: Base64 data URL
    if (!isVideo) {
      console.log(`[RunningHub Media Upload] Final image fallback: Encoding to Base64 data URL`);
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    }
  }

  return mediaUrl;
}

// Helper to format duration in MM:SS
function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Update existing Telegram status message or send new one
async function updateTelegramStatusMessage(
  chatId: number,
  messageId: number | null,
  text: string,
  replyMarkup?: any
): Promise<number | null> {
  if (messageId) {
    const editRes = await sendTelegramApi('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: replyMarkup,
      parse_mode: 'Markdown',
    });
    if (editRes?.ok && editRes?.result?.message_id) {
      return editRes.result.message_id;
    }
  }
  const sendRes = await sendTelegramApi('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
    parse_mode: 'Markdown',
  });
  if (sendRes?.ok && sendRes?.result?.message_id) {
    return sendRes.result.message_id;
  }
  return messageId;
}

interface SubmissionResult {
  taskId?: string;
  error?: string;
  apiTypeUsed?: string;
  rawResponse?: any;
}

// Helper to format consistent result notification caption across ALL models
export function formatModelResultCaption(
  inputModel: string,
  taskId: string,
  coinsUsed: number,
  remainCoinsStr: string,
  timeFormatted: string
): string {
  let modelName = 'MOTION V2 — 1080HD';
  let modelSpec = 'Motion Control V2 / 1080p Full HD';

  if (inputModel === 'motion-v2') {
    modelName = 'MOTION V2 — 1080HD';
    modelSpec = 'Motion Control V2 / 1080p Full HD';
  } else if (inputModel === 'wan-2.1') {
    modelName = 'WAN 2.1 V5';
    modelSpec = 'Wan 2.1 Animate V5 / 1080p HD';
  } else {
    const cfg = getMotionModelConfig(inputModel);
    modelName = cfg.name ? cfg.name.toUpperCase() : 'MOTION CONTROL';
    modelSpec = `${cfg.name || 'Motion Control'} / 1080p HD`;
  }

  const cleanRemain = remainCoinsStr.replace(/[*_`]/g, '').trim();

  return `✨ *${modelName}*
🎯 *${modelSpec}*

💰 Terpakai: *${coinsUsed} RH Coins*
👛 Sisa: *${cleanRemain}*
⏱️ Render: *${timeFormatted}*
🆔 Task: \`${taskId}\`

📌 File otomatis dihapus dalam 48 jam.`;
}

// Helper to format large file download notification across ALL models
export function formatModelLargeFileMessage(
  inputModel: string,
  taskId: string,
  downloadUrl: string,
  coinsUsed: number,
  remainCoinsStr: string,
  timeFormatted: string
): string {
  let modelName = 'MOTION V2 — 1080HD';
  let modelSpec = 'Motion Control V2 / 1080p Full HD';

  if (inputModel === 'motion-v2') {
    modelName = 'MOTION V2 — 1080HD';
    modelSpec = 'Motion Control V2 / 1080p Full HD';
  } else if (inputModel === 'wan-2.1') {
    modelName = 'WAN 2.1 V5';
    modelSpec = 'Wan 2.1 Animate V5 / 1080p HD';
  } else {
    const cfg = getMotionModelConfig(inputModel);
    modelName = cfg.name ? cfg.name.toUpperCase() : 'MOTION CONTROL';
    modelSpec = `${cfg.name || 'Motion Control'} / 1080p HD`;
  }

  const cleanRemain = remainCoinsStr.replace(/[*_`]/g, '').trim();

  return `✨ *${modelName}*
🎯 *${modelSpec}*

📦 *File terlalu besar untuk dikirim langsung via Telegram.*
⬇️ *Link Download:* ${downloadUrl}

💰 Terpakai: *${coinsUsed} RH Coins*
👛 Sisa: *${cleanRemain}*
⏱️ Render: *${timeFormatted}*
🆔 Task: \`${taskId}\`

📌 File otomatis dihapus dalam 48 jam.`;
}

// Multi-Route Task submission function for Wan2.2 & Kling v3.0 Character Motion Transfer
interface TaskSubmissionOptions {
  characterOrientation?: string;
  prompt?: string;
  negativePrompt?: string;
  keepOriginalSound?: boolean;
  model?: string;
  resolution?: string;
  qualityMode?: string;
  styleMode?: string;
}

async function executeTaskSubmission(
  apiKey: string,
  imageUrl: string,
  videoUrl: string,
  options?: TaskSubmissionOptions
): Promise<SubmissionResult> {
  let lastSubmitError = '';

  // Step 1: Upload media to RunningHub CDN if needed
  const rhImageUrl = imageUrl.includes('runninghub')
    ? imageUrl
    : await uploadTelegramMediaToRunningHub(imageUrl, apiKey, 'character_photo.jpg');

  const rhVideoUrl = videoUrl.includes('runninghub')
    ? videoUrl
    : await uploadTelegramMediaToRunningHub(videoUrl, apiKey, 'motion_video.mp4');

  const selectedModel = options?.model || 'motion-v2';
  const modelConfig = getMotionModelConfig(selectedModel);
  const targetId = modelConfig.workflowId || process.env.RUNNINGHUB_WORKFLOW_ID || process.env.WORKFLOW_ID || '2001911147597033473';

  // Dynamic Node Selection based on WebApp / Workflow ID
  let targetImageNode = modelConfig.imageNodeId || '17';
  let targetVideoNode = modelConfig.videoNodeId || '102';
  let targetPromptNode: string | undefined = undefined;

  if (targetId === '2083908699113918465') {
    targetImageNode = '30';
    targetVideoNode = '33';
  } else if (targetId === '2001911147597033473') {
    targetImageNode = '17';
    targetVideoNode = '102';
    targetPromptNode = '709';
  }

  const characterOrientation = options?.characterOrientation || 'video';
  const keepOriginalSound = options?.keepOriginalSound ?? true;
  const resolution = options?.resolution || '1080p';
  const qualityMode = options?.qualityMode || 'pro';
  const styleMode = options?.styleMode || 'faithful';
  const ratio = '9:16';

  const videoFieldName = ['275', '102'].includes(targetVideoNode) ? 'clip' : 'video';

  // Dynamic Pose Estimation parameter selection
  let poseType = 'sdpose';
  if (styleMode === 'anime' || styleMode === 'cartoon') {
    poseType = 'wuwupose';
  }

  const userPrompt = options?.prompt?.trim();
  let finalPrompt = userPrompt ? userPrompt : DEFAULT_REALISTIC_PROMPT;

  // 🚀 1080HD QUALITY BOOSTER FOR MOTION V2
  if (selectedModel === 'motion-v2') {
    finalPrompt = `masterpiece, best quality, ultra-detailed 1080p Full HD, 9:16 aspect ratio, crystal clear visual clarity, photorealistic 8k character render, crisp sharp focus, consistent studio lighting, physically accurate lighting and shadows, balanced light sources, 60fps smooth realistic motion, stable face identity, high fidelity video, ${finalPrompt}`;
  } else if (selectedModel === 'wan-2.1') {
    finalPrompt = `masterpiece, best quality, high fidelity motion transfer, 9:16 portrait ratio, photorealistic video output, smooth animation, ${finalPrompt}`;
  }

  const userNegative = options?.negativePrompt?.trim();
  const finalNegativePrompt = userNegative
    ? `${userNegative}, ${DEFAULT_REALISTIC_NEGATIVE_PROMPT}`
    : DEFAULT_REALISTIC_NEGATIVE_PROMPT;

  // Route 1: AI App OpenAPI (/task/openapi/ai-app/run) - Primary route for WebApp/AI-App IDs
  if (targetId) {
    const aiAppEndpoints = [
      'https://www.runninghub.ai/task/openapi/ai-app/run',
      'https://www.runninghub.cn/task/openapi/ai-app/run',
    ];

    for (const appUrl of aiAppEndpoints) {
      try {
        console.log(`[Task Submit AI App] Trying ${appUrl} (Model: ${modelConfig.name}, WebApp ID: ${targetId}, ImgNode: ${targetImageNode}, VidNode: ${targetVideoNode}, Key: ${maskKey(apiKey)})...`);

        const finalNodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: any }> = [];

        if (targetId === '2083908699113918465') {
          // Dedicated Exact Node mapping for Motion V2 1080HD
          finalNodeInfoList.push(
            { nodeId: '30', fieldName: 'image', fieldValue: rhImageUrl },
            { nodeId: '33', fieldName: 'video', fieldValue: rhVideoUrl }
          );
        } else {
          finalNodeInfoList.push(
            { nodeId: targetImageNode, fieldName: 'image', fieldValue: rhImageUrl },
            { nodeId: targetVideoNode, fieldName: videoFieldName, fieldValue: rhVideoUrl }
          );
        }

        if (targetPromptNode) {
          finalNodeInfoList.push({
            nodeId: targetPromptNode,
            fieldName: 'text',
            fieldValue: finalPrompt,
          });
        }

        const res = await fetch(appUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'apikey': apiKey,
          },
          body: JSON.stringify({
            apiKey,
            webappId: targetId,
            nodeInfoList: finalNodeInfoList,
            prompt: finalPrompt,
            negativePrompt: finalNegativePrompt,
            ratio: '9:16',
            aspect_ratio: '9:16',
            aspectRatio: '9:16',
            resolution: resolution,
            resolution_mode: resolution,
            quality: 'high',
            quality_mode: qualityMode,
            mode: qualityMode,
            upscale: true,
            hd: true,
            high_definition: true,
            video_bitrate: 'high',
            bitrate: 'high',
            fps: 60,
            pose_type: poseType,
            pose_model: poseType,
            pose_calculation: poseType,
            face_restore: true,
            face_enhancement: true,
            face_restore_weight: 0.5,
            expression_fidelity: 0.7,
            cfg_scale: 8.0,
          }),
          signal: AbortSignal.timeout(20000),
        });

        const data = await res.json().catch(() => ({}));
        console.log(`[Task Submit AI App] ${appUrl} response (${res.status}):`, data);

        const createdTaskId = data.taskId || data.data?.taskId;
        if (createdTaskId) {
          return {
            taskId: createdTaskId,
            apiTypeUsed: `AI App OpenAPI (${modelConfig.name} - ${targetId})`,
            rawResponse: data,
          };
        }

        const code = data.code;
        const errMsg =
          data.errorMessage ||
          data.msg ||
          data.message ||
          (code !== undefined ? `Code ${code}` : `HTTP ${res.status}`);

        const isInsufficientFunds =
          code === 414 ||
          /insufficient|corporate funds|top up|not_enough_power|no power|out of coins/i.test(errMsg);

        if (isInsufficientFunds) {
          lastSubmitError = `RunningHub Error: Insufficient corporate funds, please top up (0 RH Coins)`;
          console.warn(`[Task Submit AI App] Key ${maskKey(apiKey)} is OUT OF FUNDS (${errMsg}). Breaking early to rotate key.`);
          return { error: lastSubmitError };
        }

        // Specific handling for known RunningHub error codes
        if (code === 421) {
          lastSubmitError = `RunningHub Error 421: TASK_QUEUE_MAXED (Antrean API Key sedang penuh)`;
        } else if (code === 301) {
          lastSubmitError = `RunningHub Error 301: USER_NOT_EXIST (API Key tidak terdaftar di pemilik WebApp ini)`;
        } else {
          lastSubmitError = errMsg;
        }
      } catch (e: any) {
        console.error(`[Task Submit AI App] Error requesting ${appUrl}:`, e.message);
        lastSubmitError = e.message;
      }
    }
  }

  // Route 2: Workflow OpenAPI (/task/openapi/create) - Backup for raw Workflow IDs
  if (targetId && !lastSubmitError.includes('421') && !lastSubmitError.includes('414') && !lastSubmitError.includes('Insufficient corporate funds')) {
    const workflowEndpoints = [
      'https://www.runninghub.ai/task/openapi/create',
      'https://www.runninghub.cn/task/openapi/create',
    ];

    for (const wfUrl of workflowEndpoints) {
      try {
        console.log(`[Task Submit Workflow] Trying ${wfUrl} (Model: ${modelConfig.name}, Workflow ID: ${targetId}, Key: ${maskKey(apiKey)})...`);

        const finalNodeFeeList: Array<{ nodeId: string; fieldName: string; fieldValue: any }> = [];

        if (targetId === '2083908699113918465') {
          finalNodeFeeList.push(
            { nodeId: '30', fieldName: 'image', fieldValue: rhImageUrl },
            { nodeId: '33', fieldName: 'video', fieldValue: rhVideoUrl }
          );
        } else {
          finalNodeFeeList.push(
            { nodeId: targetImageNode, fieldName: 'image', fieldValue: rhImageUrl },
            { nodeId: targetVideoNode, fieldName: videoFieldName, fieldValue: rhVideoUrl }
          );
        }

        if (targetPromptNode) {
          finalNodeFeeList.push({
            nodeId: targetPromptNode,
            fieldName: 'text',
            fieldValue: finalPrompt,
          });
        }

        const res = await fetch(wfUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'apikey': apiKey,
          },
          body: JSON.stringify({
            apiKey,
            workflowId: targetId,
            nodeInfoList: finalNodeFeeList,
            nodeFeeList: finalNodeFeeList,
            prompt: finalPrompt,
            negativePrompt: finalNegativePrompt,
            ratio: '9:16',
            aspect_ratio: '9:16',
            aspectRatio: '9:16',
            resolution: resolution,
            resolution_mode: resolution,
            quality: 'high',
            quality_mode: qualityMode,
            mode: qualityMode,
            upscale: true,
            hd: true,
            high_definition: true,
            video_bitrate: 'high',
            bitrate: 'high',
            fps: 60,
            pose_type: poseType,
            pose_model: poseType,
            pose_calculation: poseType,
            face_restore: true,
            face_enhancement: true,
            face_restore_weight: 0.5,
            expression_fidelity: 0.7,
            cfg_scale: 8.0,
          }),
          signal: AbortSignal.timeout(20000),
        });

        const data = await res.json().catch(() => ({}));
        console.log(`[Task Submit Workflow] ${wfUrl} response (${res.status}):`, data);

        const createdTaskId = data.taskId || data.data?.taskId;
        if (createdTaskId) {
          return {
            taskId: createdTaskId,
            apiTypeUsed: `Workflow OpenAPI (${modelConfig.name} - ${targetId})`,
            rawResponse: data,
          };
        }

        const code = data.code;
        const errMsg =
          data.errorMessage ||
          data.msg ||
          data.message ||
          (code !== undefined ? `Code ${code}` : `HTTP ${res.status}`);

        const isInsufficientFunds =
          code === 414 ||
          /insufficient|corporate funds|top up|not_enough_power|no power|out of coins/i.test(errMsg);

        if (isInsufficientFunds) {
          lastSubmitError = `RunningHub Error: Insufficient corporate funds, please top up (0 RH Coins)`;
          console.warn(`[Task Submit Workflow] Key ${maskKey(apiKey)} is OUT OF FUNDS (${errMsg}). Breaking early to rotate key.`);
          return { error: lastSubmitError };
        }
      } catch (e: any) {
        console.error(`[Task Submit Workflow] Error requesting ${wfUrl}:`, e.message);
      }
    }
  }

  // Route 2.5: Fallback to Universal High-Resolution Workflow (2001911147597033473) if Motion V2 ID (2083908699113918465) failed
  if (targetId !== '2001911147597033473' && !lastSubmitError.includes('421') && !lastSubmitError.includes('414')) {
    const fallbackWfUrl = 'https://www.runninghub.ai/task/openapi/create';
    try {
      console.log(`[Task Submit Fallback Workflow] Trying 2001911147597033473 for ${modelConfig.name} (Key: ${maskKey(apiKey)})...`);
      const fallbackFeeList: Array<{ nodeId: string; fieldName: string; fieldValue: any }> = [
        { nodeId: '17', fieldName: 'image', fieldValue: rhImageUrl },
        { nodeId: '102', fieldName: 'clip', fieldValue: rhVideoUrl },
        { nodeId: '709', fieldName: 'text', fieldValue: finalPrompt },
      ];

      const res = await fetch(fallbackWfUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'apikey': apiKey,
        },
        body: JSON.stringify({
          apiKey,
          workflowId: '2001911147597033473',
          nodeInfoList: fallbackFeeList,
          nodeFeeList: fallbackFeeList,
          prompt: finalPrompt,
          negativePrompt: finalNegativePrompt,
          ratio: '9:16',
          aspect_ratio: '9:16',
          aspectRatio: '9:16',
          resolution: resolution,
          resolution_mode: resolution,
          quality: 'high',
          quality_mode: qualityMode,
          mode: qualityMode,
          upscale: true,
          hd: true,
          high_definition: true,
          video_bitrate: 'high',
          bitrate: 'high',
          fps: 60,
          pose_type: poseType,
          pose_model: poseType,
          pose_calculation: poseType,
          face_restore: true,
          face_enhancement: true,
          face_restore_weight: 0.5,
          expression_fidelity: 0.7,
          cfg_scale: 8.0,
        }),
        signal: AbortSignal.timeout(20000),
      });

      const data = await res.json().catch(() => ({}));
      const createdTaskId = data.taskId || data.data?.taskId;
      if (createdTaskId) {
        return {
          taskId: createdTaskId,
          apiTypeUsed: `Universal 1080HD Engine (${modelConfig.name})`,
          rawResponse: data,
        };
      }
    } catch (fbErr: any) {
      console.error(`[Task Submit Fallback Workflow] Error:`, fbErr.message);
    }
  }

  // Route 3: Direct Model API (Wan 2.2 / Kling v3.0) - For Enterprise API Keys
  if (!lastSubmitError.includes('421') && !lastSubmitError.includes('414') && !lastSubmitError.includes('301')) {
    let directImageParam = rhImageUrl;
    if (rhImageUrl.startsWith('http')) {
      try {
        const imgFetch = await fetch(rhImageUrl, { signal: AbortSignal.timeout(5000) });
        if (imgFetch.ok) {
          const buf = Buffer.from(await imgFetch.arrayBuffer());
          const mime = imgFetch.headers.get('content-type') || 'image/jpeg';
          directImageParam = `data:${mime};base64,${buf.toString('base64')}`;
        }
      } catch (e: any) {
        console.warn(`[Task Submit Direct] Base64 image conversion skipped:`, e.message);
      }
    }

    const directEndpointsList = [
      {
        url: 'https://www.runninghub.ai/openapi/v2/rhart-video/wan2.2/character-motion-transfer',
        name: 'Wan2.2 Direct Model API (1080p HD)',
        type: 'wan',
      },
      {
        url: 'https://www.runninghub.cn/openapi/v2/rhart-video/wan2.2/character-motion-transfer',
        name: 'Wan2.2 Direct Model API (1080p HD)',
        type: 'wan',
      },
    ];

    const directEndpoints = directEndpointsList;

    for (const endpoint of directEndpoints) {
      try {
        console.log(`[Task Submit Direct] Trying ${endpoint.url} (${endpoint.name}, Key: ${maskKey(apiKey)})...`);

        const res = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'apikey': apiKey,
          },
          body: JSON.stringify({
            apiKey,
            imageUrl: directImageParam,
            videoUrl: rhVideoUrl,
            image_url: directImageParam,
            video_url: rhVideoUrl,
            resolution: resolution,
            resolution_mode: resolution,
            quality: 'high',
            quality_mode: qualityMode,
            mode: qualityMode,
            characterOrientation,
            character_orientation: characterOrientation,
            ratio: '9:16',
            aspect_ratio: '9:16',
            aspectRatio: '9:16',
            prompt: finalPrompt,
            prompt_text: finalPrompt,
            negativePrompt: finalNegativePrompt,
            negative_prompt: finalNegativePrompt,
            keepOriginalSound,
            keep_original_sound: keepOriginalSound,
            upscale: true,
            hd: true,
            high_definition: true,
            video_bitrate: 'high',
            bitrate: 'high',
            fps: 60,
            frame_rate: 60,
            pose_type: poseType,
            pose_model: poseType,
            pose_calculation: poseType,
            face_restore: true,
            face_enhancement: true,
            face_restore_weight: 0.5,
            expression_fidelity: 0.7,
            cfg_scale: 8.0,
          }),
          signal: AbortSignal.timeout(15000),
        });

        const data = await res.json().catch(() => ({}));
        console.log(`[Task Submit Direct] ${endpoint.url} response (${res.status}):`, data);

        const createdTaskId = data.taskId || data.data?.taskId;
        if (createdTaskId) {
          return {
            taskId: createdTaskId,
            apiTypeUsed: endpoint.name,
            rawResponse: data,
          };
        }
      } catch (e: any) {
        console.error(`[Task Submit Direct] Error requesting ${endpoint.url}:`, e.message);
      }
    }
  }

  return {
    error: lastSubmitError || 'Gagal mengirim tugas ke RunningHub API.',
  };
}

// Motion Control execution process for Telegram Bot using Direct API & Auto Key Rotation
async function processTelegramMotionControlTask(chatId: number, session: TelegramUserSession) {
  // Backend access control verification
  const user = botUsers.find((u) => u.chatId === chatId || u.id === chatId);
  const isAdmin = user?.role === 'admin' || adminUserIds.includes(chatId);
  console.log(`[Telegram Bot] Processing Motion Control Task for ${isAdmin ? 'Admin' : 'Member'} (ChatID: ${chatId}, Model: ${session.selectedModel})...`);

  if (!isAdmin) {
    if (!user || user.status === 'pending') {
      await sendPendingAccessMessage(chatId, user?.firstName);
      session.step = 'idle';
      return;
    }
    if (user.status === 'blocked') {
      await sendBlockedAccessMessage(chatId);
      session.step = 'idle';
      return;
    }
  }

  if (!session.imageUrl || !session.videoUrl) {
    await sendTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `⚠️ *Media Belum Lengkap!*\n\n• Foto Karakter: ${session.imageUrl ? '✅ Siap' : '❌ Belum Ada'}\n• Video Gerakan: ${session.videoUrl ? '✅ Siap' : '❌ Belum Ada'}\n\nSilakan kirimkan ${!session.imageUrl ? 'Foto Karakter' : 'Video Gerakan'} terlebih dahulu agar video yang dihasilkan sesuai!`,
      parse_mode: 'Markdown',
    });
    session.step = !session.imageUrl ? 'awaiting_photo' : 'awaiting_video';
    return;
  }

  // ATOMIC PARALLEL JOBS ACQUISITION CHECK (Max 2 active jobs per member)
  const trackingJobId = `job-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const selectedModel = session.selectedModel || 'motion-v2';
  const userFullName = user ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}` : 'Unknown Member';

  const acquireResult = acquireJobSlot(chatId, trackingJobId, selectedModel, isAdmin, userFullName);
  if (!acquireResult.success) {
    await sendTelegramApi('sendMessage', {
      chat_id: chatId,
      text: PARALLEL_LIMIT_REJECTION_TEXT,
      parse_mode: 'Markdown',
    });
    session.step = 'idle';
    return;
  }

  // Snapshot input parameters for this task execution instance
  const inputPhoto = session.imageUrl;
  const inputVideo = session.videoUrl;
  const inputPrompt = session.prompt;
  const inputModel = selectedModel;
  const inputApiKeyParam = session.userApiKey;

  // Immediately release interactive session state so member can interact or submit another job in parallel
  session.step = 'idle';
  session.imageUrl = undefined;
  session.videoUrl = undefined;
  session.prompt = undefined;

  const candidates = getCandidateKeys(inputApiKeyParam);

  // Filter candidates that are valid and have > 0 coins or unverified balance
  const eligibleCandidates = candidates.filter((c) => {
    if (c.status === 'invalid' || c.status === 'non_enterprise') return false;
    if (typeof c.remainCoins === 'number' && c.remainCoins <= 0) return false;
    return true;
  });

  if (eligibleCandidates.length === 0) {
    releaseJobSlot(chatId, trackingJobId);
    await sendTelegramApi('sendMessage', {
      chat_id: chatId,
      text: `❌ KEY HABIS\n\nHUBUNGI ADMIN`,
    });
    return;
  }

  const startTime = Date.now();

  let statusMsgId = await updateTelegramStatusMessage(
    chatId,
    null,
    `⏳ *Motion Control sedang diproses*\n🎯 Model: *${getModelLabel(inputModel)}*\nStatus: 🟡 UPLOADING — foto & video sedang disiapkan...\nWaktu berjalan: 00:00\nMohon tunggu...`
  );

  let activeApiKey = '';
  let taskId = '';
  let apiTypeUsed = '';
  let lastSubmitError = '';
  let initialCoins = 0;

  try {

    for (let idx = 0; idx < eligibleCandidates.length; idx++) {
      const candidate = eligibleCandidates[idx];

      // Fast check: If key is recorded with 0 coins, skip early
      if (typeof candidate.remainCoins === 'number' && candidate.remainCoins <= 0 && candidate.status === 'non_enterprise') {
        console.log(`[Telegram Bot] Key ${maskKey(candidate.key)} skipped (0 RH Coins recorded).`);
        continue;
      }

      // Fast submission attempt
      activeApiKey = candidate.key;
      initialCoins = candidate.remainCoins || 0;
      console.log(`[Telegram Bot] Fast submission with candidate #${idx + 1}/${eligibleCandidates.length} (${maskKey(candidate.key)}, Recorded Coins: ${initialCoins})...`);

      statusMsgId = await updateTelegramStatusMessage(
        chatId,
        statusMsgId,
        `⏳ *Motion Control sedang diproses*\n🎯 Model: *${getModelLabel(inputModel)}*\nStatus: 🟡 SUBMITTING — Mengirim tugas ke RunningHub...\nWaktu berjalan: ${formatElapsed(Math.floor((Date.now() - startTime) / 1000))}\nMohon tunggu...`
      );

      const subRes = await executeTaskSubmission(candidate.key, inputPhoto, inputVideo, {
        model: inputModel,
        characterOrientation: 'video',
        keepOriginalSound: true,
        resolution: '1080p',
        qualityMode: 'pro',
        styleMode: 'faithful',
        prompt: inputPrompt,
      });

      if (subRes.taskId) {
        taskId = subRes.taskId;
        apiTypeUsed = subRes.apiTypeUsed || 'RunningHub API';
        updateJobSlotStatus(chatId, trackingJobId, 'QUEUED', taskId);
        
        // 📊 Record for Admin Monitoring
        const modelCfg = getMotionModelConfig(inputModel);
        recordTask({
          id: taskId,
          telegramUserId: chatId,
          userName: user ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}` : 'Unknown Member',
          model: inputModel,
          workflowId: modelCfg.workflowId || 'N/A',
          apiKeyId: getMaskedKey(activeApiKey),
          startTime: Date.now(),
          status: 'QUEUED'
        });

        candidate.status = 'enterprise';
        if (candidate.remainCoins) {
          candidate.statusLabel = `🟢 Aktif (${candidate.remainCoins} RH Coins)`;
        }
        candidate.lastUsedAt = new Date().toISOString();
        candidate.lastError = undefined;
        saveApiKeyPoolToFile();
        break;
      }

      lastSubmitError = subRes.error || 'Gagal membuat tugas di RunningHub';
      candidate.lastError = subRes.error;
      
      if (/insufficient|corporate funds|top up|not_enough_power|414|0 rh coins/i.test(lastSubmitError)) {
        candidate.remainCoins = 0;
        candidate.status = 'non_enterprise';
        candidate.statusLabel = '🟡 0 Saldo RH Coins';
        saveApiKeyPoolToFile();
      }

      console.log(`[Telegram Bot] Key ${maskKey(candidate.key)} failed: ${subRes.error}. Instantly switching to next candidate key...`);
    }

    if (!taskId) {
      if (statusMsgId) {
        await updateTelegramStatusMessage(
          chatId,
          statusMsgId,
          `❌ KEY HABIS\n\nHUBUNGI ADMIN`
        );
      } else {
        await sendTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `❌ KEY HABIS\n\nHUBUNGI ADMIN`,
        });
      }
      return;
    }

    // Step 3: Polling taskId with live status updates
    session.lastTaskId = taskId;
    const initialElapsed = Math.floor((Date.now() - startTime) / 1000);

    statusMsgId = await updateTelegramStatusMessage(
      chatId,
      statusMsgId,
      `⏳ *Motion Control sedang diproses*\n🎯 Model: *${getModelLabel(inputModel)} (${apiTypeUsed})*\nStatus: 🟡 QUEUED — task diterima, mengantri\nTask ID: \`${taskId}\`\nWaktu berjalan: ${formatElapsed(initialElapsed)}\nMohon tunggu...`
    );

    let done = false;
    let attempts = 0;
    const MAX_POLLING_ATTEMPTS = 900; // 30 minutes (900 * 2s = 1800s)
    let lastTelegramUpdate = 0;
    let lastParsedStatus = '';

    while (!done && attempts < MAX_POLLING_ATTEMPTS) {
      attempts++;
      await new Promise((r) => setTimeout(r, 2000));

      const currentElapsed = Math.floor((Date.now() - startTime) / 1000);
      const timeFormatted = formatElapsed(currentElapsed);

      try {
        const parsed = await queryRunningHubTask(taskId, activeApiKey);

        if (parsed.status === 'SUCCESS' && (parsed.videoUrl || parsed.results.length > 0)) {
          done = true;
          const resultUrl = parsed.videoUrl || parsed.results[0]?.url;

          // Fetch final coins to calculate exact credits used
          let remainCoinsStr = '_Memuat sisa saldo..._';
          let coinsUsed = 15;
          try {
            const finalStatus = await checkAccountStatus(activeApiKey);
            if (finalStatus && finalStatus.remainCoins !== undefined) {
              remainCoinsStr = `*${finalStatus.remainCoins} RH Coins*`;
              if (initialCoins > 0) {
                const diff = initialCoins - finalStatus.remainCoins;
                if (diff > 0) {
                  coinsUsed = diff;
                }
              }
            }
          } catch (balanceErr: any) {
            console.error('[Telegram Post-Task Balance Error]', balanceErr.message);
          }

          if (resultUrl) {
            console.log(`[Telegram Bot] Video completed. URL: ${resultUrl}`);
            
            // 📊 Record SUCCESS
            recordTask({
              id: taskId,
              status: 'SUCCESS',
              endTime: Date.now(),
              resultUrl: resultUrl,
              duration: Math.round((Date.now() - startTime) / 1000)
            });

            const videoFileName = `motion_control_${taskId}.mp4`;
            
            // 🎬 Download and Verify Video Integrity into Local Persistent Cache
            const verification = await downloadAndVerifyVideo(resultUrl, taskId);
            
            // Generate permanent local proxy download URL hosted on our server
            const localDownloadUrl = `${getPublicServerUrl()}/api/download/motion_control_${taskId}.mp4`;
            
            const videoCaption = formatModelResultCaption(inputModel, taskId, coinsUsed, remainCoinsStr, timeFormatted);
            const largeFileMessage = formatModelLargeFileMessage(inputModel, taskId, localDownloadUrl, coinsUsed, remainCoinsStr, timeFormatted);

            // 0. Check File Size first (Telegram Bot API limit is 50MB for multipart)
            const isLargeFile = (verification?.buffer?.length || 0) > 48 * 1024 * 1024; // 48MB threshold
            let videoSent: any = null;

            if (isLargeFile) {
              // 📦 File is too large for direct Telegram transfer (>48MB) -> Send Direct Download Link
              console.log(`[Telegram Bot] File is large (${((verification?.buffer?.length || 0) / 1024 / 1024).toFixed(2)}MB). Delivering direct download link: ${localDownloadUrl}`);
              
              const linkRes = await updateTelegramStatusMessage(
                chatId,
                statusMsgId,
                largeFileMessage
              );

              if (linkRes) {
                scheduleAutoDeleteVideo(chatId, linkRes, getModelLabel(inputModel), taskId);
              }
            } else if (verification && verification.success) {
              // 🎥 Normal File Size (<=48MB) -> Send Video Directly to Telegram Chat (NO extra buttons)
              videoSent = await sendTelegramFileMultipart('sendVideo', chatId, resultUrl, videoFileName, videoCaption, undefined, {
                supports_streaming: true,
                parse_mode: 'Markdown',
              }, verification.buffer);

              // Fallback 1: sendDocument via multipart if sendVideo failed
              if (!videoSent || !videoSent.ok) {
                console.log(`[Telegram Bot] sendVideo failed. Trying sendDocument multipart fallback...`);
                videoSent = await sendTelegramFileMultipart('sendDocument', chatId, resultUrl, videoFileName, videoCaption, undefined, {
                  parse_mode: 'Markdown',
                }, verification.buffer);
              }

              // Fallback 2: URL-based sendVideo via local high-speed proxy
              if (!videoSent || !videoSent.ok) {
                console.log(`[Telegram Bot] Multipart upload failed. Trying URL-based sendVideo via local server proxy...`);
                videoSent = await sendTelegramApi('sendVideo', {
                  chat_id: chatId,
                  video: `${getPublicServerUrl()}/api/video/${taskId}.mp4`,
                  caption: videoCaption,
                  supports_streaming: true,
                  parse_mode: 'Markdown',
                });
              }

              // Fallback 3: URL-based sendVideo via RunningHub CDN URL directly
              if (!videoSent || !videoSent.ok) {
                console.log(`[Telegram Bot] Proxy sendVideo failed. Trying raw RunningHub URL...`);
                videoSent = await sendTelegramApi('sendVideo', {
                  chat_id: chatId,
                  video: resultUrl,
                  caption: videoCaption,
                  supports_streaming: true,
                  parse_mode: 'Markdown',
                });
              }

              if (videoSent && videoSent.ok && videoSent.result?.message_id) {
                // Delete the intermediate status message so only the clean video remains
                if (statusMsgId) {
                  sendTelegramApi('deleteMessage', { chat_id: chatId, message_id: statusMsgId }).catch(() => {});
                }
                // Schedule Auto-Delete in 48 Hours
                scheduleAutoDeleteVideo(chatId, videoSent.result.message_id, getModelLabel(inputModel), taskId);
              } else {
                // Delivery to chat failed due to Telegram network limits -> Send Download Link
                console.log(`[Telegram Bot] All direct transfers failed. Falling back to local server download link: ${localDownloadUrl}`);
                const linkRes = await updateTelegramStatusMessage(
                  chatId,
                  statusMsgId,
                  largeFileMessage
                );
                if (linkRes) {
                  scheduleAutoDeleteVideo(chatId, linkRes, getModelLabel(inputModel), taskId);
                }
              }
            } else {
              // Video verification failed completely (corrupt stream from RunningHub)
              const finalError = verification?.error || 'Pipeline Validation Failed';
              recordTask({
                id: taskId,
                status: 'FAILED',
                endTime: Date.now(),
                errorMessage: `Video Pipeline Corrupt: ${finalError}`
              });

              await updateTelegramStatusMessage(
                chatId,
                statusMsgId,
                `❌ *GENERATE GAGAL (VIDEO RUSAK)*\n\nHasil video dari RunningHub tidak valid setelah beberapa kali percobaan download.\n\n⚠️ Error: \`${finalError}\`\n🆔 Task ID: \`${taskId}\`\n\nMohon coba generate ulang beberapa saat lagi.`
              );

              if (!isAdmin) {
                for (const adminId of adminUserIds) {
                  sendTelegramApi('sendMessage', {
                    chat_id: adminId,
                    text: `🚨 *NOTIFIKASI ERROR PIPELINE*\n\nUser: \`${user?.firstName}\` (${chatId})\nTask ID: \`${taskId}\`\nError: \`${finalError}\`\n\nVideo dari RunningHub terdeteksi corrupt dan gagal dikirim.`
                  }).catch(() => {});
                }
              }
              return;
            }
          }
          if (user) {
            user.generatedCount = (user.generatedCount || 0) + 1;
            user.lastActiveAt = new Date().toISOString();
            saveTelegramUsers();
          }
        } else if (parsed.status === 'FAILED') {
          done = true;
          const errReason = parsed.errorMessage || 'Task failed on RunningHub';
          
          // 📊 Record FAILED
          recordTask({
            id: taskId,
            status: 'FAILED',
            endTime: Date.now(),
            errorMessage: errReason
          });

          await updateTelegramStatusMessage(
            chatId,
            statusMsgId,
            `❌ *Motion Control Gagal di RunningHub*\n\nError: \`${errReason}\`\nTask ID: \`${taskId}\`\nTotal waktu: ${timeFormatted}`
          );
        } else {
          const now = Date.now();
          const statusChanged = parsed.status !== lastParsedStatus;
          const timeElapsedSinceLastUpdate = now - lastTelegramUpdate;

          if (statusChanged || timeElapsedSinceLastUpdate >= 8000) {
            lastTelegramUpdate = now;
            lastParsedStatus = parsed.status;

            const statusLabel =
              parsed.status === 'QUEUED' || attempts <= 1
                ? '🟡 QUEUED — Mengantri di server RunningHub'
                : '🔵 RUNNING — RunningHub sedang merender motion frame...';

            statusMsgId = await updateTelegramStatusMessage(
              chatId,
              statusMsgId,
              `⏳ *Motion Control sedang diproses*\n🎯 Model: *${getModelLabel(inputModel)}*\n🌟 Quality: *Standard Mode*\nStatus: ${statusLabel}\nTask ID: \`${taskId}\`\nWaktu berjalan: ${timeFormatted}\nMohon tunggu...`
            );
          }
          
          // 📊 Update Monitoring: Processing
          if (parsed.status === 'RUNNING') {
            updateJobSlotStatus(chatId, trackingJobId, 'RUNNING', taskId);
            recordTask({ id: taskId, status: 'PROCESSING' });
          }
        }
      } catch (pollErr: any) {
        console.error('[Telegram Polling Exception]', pollErr.message);
      }
    }

    if (!done) {
      await updateTelegramStatusMessage(
        chatId,
        statusMsgId,
        `⚠️ *Polling Timeout*\nTask ID: \`${taskId}\` masih berjalan di RunningHub.`
      );
    }
  } catch (rhErr: any) {
    console.error('[Telegram Process Motion Control Error]', rhErr);
    await updateTelegramStatusMessage(
      chatId,
      statusMsgId,
      `❌ *System Error*: \`${rhErr.message || 'Error processing motion control'}\``
    );
  } finally {
    releaseJobSlot(chatId, trackingJobId);
    console.log(`[Parallel Jobs] Released slot for ChatId: ${chatId}, Job: ${trackingJobId}. Active remaining: ${getMemberActiveCount(chatId)}/2`);
  }
}

// Immediately trigger initialization of Telegram bot
initTelegramBotEngine();

// Telegram Bot Status & Configuration API Endpoints
app.get('/api/telegram/status', (_req, res) => {
  res.json({
    status: telegramBotStatus,
    botInfo: telegramBotInfo,
    error: telegramLastError,
    processedMessages: processedMessagesCount,
    hasToken: Boolean(activeTelegramToken && activeTelegramToken.length > 10),
    sessions: telegramSessions
  });
});

app.post('/api/telegram/config', async (req, res) => {
  const { botToken } = req.body;
  if (typeof botToken === 'string') {
    activeTelegramToken = botToken.trim();
    telegramPollingActive = false;
    await new Promise((r) => setTimeout(r, 1000));
    initTelegramBotEngine();
    return res.json({
      success: true,
      message: 'Telegram Bot Token updated and engine reloaded.',
      status: telegramBotStatus,
      botInfo: telegramBotInfo,
    });
  }
  return res.status(400).json({ error: 'botToken string is required' });
});

// 🎬 DIRECT HIGH-SPEED VIDEO PROXY & DOWNLOAD ENDPOINTS
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
  const filePath = path.join(VIDEO_STORAGE_DIR, filename);

  if (fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': stats.size,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=172800',
      });
      const readStream = fs.createReadStream(filePath);
      return readStream.pipe(res);
    } catch (e: any) {
      console.error('[Download Error]', e.message);
    }
  }

  return res.status(404).send('Video file not found or expired. Videos are stored for 48 hours.');
});

app.get('/api/video/:taskId', (req, res) => {
  const taskId = req.params.taskId.replace(/[^a-zA-Z0-9._-]/g, '');
  const filename = taskId.endsWith('.mp4') ? taskId : `motion_control_${taskId}.mp4`;
  const filePath = path.join(VIDEO_STORAGE_DIR, filename);

  if (fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': stats.size,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=172800',
      });
      const readStream = fs.createReadStream(filePath);
      return readStream.pipe(res);
    } catch (e: any) {
      console.error('[Video Stream Error]', e.message);
    }
  }

  return res.status(404).send('Video stream not found or expired.');
});

// RunningHub API Key Pool REST Endpoints
app.get('/api/keys', (_req, res) => {
  res.json({
    keys: apiKeyPool.map((item) => ({
      ...item,
      maskedKey: maskKey(item.key),
    })),
    autoRotate: autoRotateEnabled,
    totalKeys: apiKeyPool.length,
  });
});

app.post('/api/keys', async (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string' || key.trim().length < 8) {
    return res.status(400).json({ error: 'Valid API Key string is required' });
  }

  const cleanKey = key.trim();
  let existing = apiKeyPool.find((k) => k.key === cleanKey);

  if (!existing) {
    existing = {
      id: `key-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      key: cleanKey,
      status: 'unverified',
      statusLabel: getStatusLabel('unverified'),
      addedAt: new Date().toISOString(),
    };
    apiKeyPool.push(existing);
  }

  // Verify status
  await verifyApiKeyItem(existing);
  saveApiKeyPoolToFile();

  return res.json({
    success: true,
    keyItem: {
      ...existing,
      maskedKey: maskKey(existing.key),
    },
    keys: apiKeyPool.map((item) => ({
      ...item,
      maskedKey: maskKey(item.key),
    })),
  });
});

app.post('/api/keys/bulk', async (req, res) => {
  const { keys, keysText } = req.body;
  let rawList: string[] = [];
  if (Array.isArray(keys)) {
    rawList = keys.map((k) => String(k));
  } else if (typeof keysText === 'string') {
    rawList = keysText.split(/[\r\n,]+/);
  } else {
    return res.status(400).json({ error: 'keys array or keysText string is required' });
  }

  const summary = await processBulkKeys(rawList);

  return res.json({
    success: true,
    summary,
    keys: apiKeyPool.map((item) => ({
      ...item,
      maskedKey: maskKey(item.key),
    })),
  });
});

app.delete('/api/keys/:id', (req, res) => {
  const { id } = req.params;
  const initialCount = apiKeyPool.length;
  const removedItems = apiKeyPool.filter((k) => k.id === id || k.key === id);
  apiKeyPool = apiKeyPool.filter((k) => k.id !== id && k.key !== id);
  removedItems.forEach((item) => {
    if (item.key && !deletedKeysList.includes(item.key)) {
      deletedKeysList.push(item.key);
    }
  });
  saveDeletedKeys();
  saveApiKeyPoolToFile();

  res.json({
    success: true,
    removedCount: initialCount - apiKeyPool.length,
    keys: apiKeyPool.map((item) => ({
      ...item,
      maskedKey: maskKey(item.key),
    })),
  });
});

app.delete('/api/keys', (_req, res) => {
  const initialCount = apiKeyPool.length;
  apiKeyPool.forEach((item) => {
    if (item.key && !deletedKeysList.includes(item.key)) {
      deletedKeysList.push(item.key);
    }
  });
  saveDeletedKeys();
  apiKeyPool = [];
  saveApiKeyPoolToFile();

  res.json({
    success: true,
    removedCount: initialCount,
    keys: [],
  });
});

app.post('/api/keys/verify-all', async (_req, res) => {
  for (let i = 0; i < apiKeyPool.length; i++) {
    await verifyApiKeyItem(apiKeyPool[i]);
  }
  saveApiKeyPoolToFile();
  res.json({
    success: true,
    keys: apiKeyPool.map((item) => ({
      ...item,
      maskedKey: maskKey(item.key),
    })),
  });
});

app.post('/api/keys/toggle-auto-rotate', (req, res) => {
  if (typeof req.body.enabled === 'boolean') {
    autoRotateEnabled = req.body.enabled;
  } else {
    autoRotateEnabled = !autoRotateEnabled;
  }
  res.json({
    success: true,
    autoRotate: autoRotateEnabled,
  });
});

// Bot Users Management Endpoints
app.get('/api/users', (_req, res) => {
  res.json({
    users: botUsers,
    adminUserIds,
    stats: {
      total: botUsers.length,
      active: botUsers.filter((u) => u.status === 'active').length,
      pending: botUsers.filter((u) => u.status === 'pending').length,
      blocked: botUsers.filter((u) => u.status === 'blocked').length,
      admins: botUsers.filter((u) => u.role === 'admin').length,
      totalGenerated: botUsers.reduce((sum, u) => sum + (u.generatedCount || 0), 0),
    },
  });
});

app.post('/api/users/:id/approve', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const user = botUsers.find((u) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.status = 'active';
  user.approvedAt = new Date().toISOString();
  saveTelegramUsers();

  // Notify user via Telegram
  if (user.chatId) {
    sendTelegramApi('sendMessage', {
      chat_id: user.chatId,
      text: `🎉 *Selamat! Akses Anda Telah Disetujui Admin.*\n\nAkun Anda sekarang aktif dan dapat langsung menggunakan generator video Motion Control AI (Wan 2.1 & Kling V3.0) 🚀\n\nKetik /start untuk membuka menu generator!`,
      parse_mode: 'Markdown',
    }).catch((e) => console.warn('[Approve Notify Error]', e.message));
  }

  res.json({ success: true, user });
});

app.post('/api/users/:id/reject', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const user = botUsers.find((u) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.status = 'blocked';
  user.rejectedAt = new Date().toISOString();
  user.blockedAt = new Date().toISOString();
  saveTelegramUsers();

  if (user.chatId) {
    sendTelegramApi('sendMessage', {
      chat_id: user.chatId,
      text: `🚫 *Akses Ditolak*\n\nAkses Anda untuk menggunakan generator bot ini telah dinonaktifkan oleh Admin.`,
      parse_mode: 'Markdown',
    }).catch((e) => console.warn('[Reject Notify Error]', e.message));
  }

  res.json({ success: true, user });
});

app.post('/api/users/:id/role', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { role } = req.body;
  if (role !== 'admin' && role !== 'user') {
    return res.status(400).json({ error: "role must be 'admin' or 'user'" });
  }

  const user = botUsers.find((u) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.role = role;
  if (role === 'admin') {
    user.status = 'active';
    if (!adminUserIds.includes(userId)) adminUserIds.push(userId);
  } else {
    adminUserIds = adminUserIds.filter((id) => id !== userId);
  }
  saveTelegramUsers();

  res.json({ success: true, user, adminUserIds });
});

app.delete('/api/users/:id', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const before = botUsers.length;
  botUsers = botUsers.filter((u) => u.id !== userId);
  adminUserIds = adminUserIds.filter((id) => id !== userId);
  saveTelegramUsers();

  res.json({ success: true, removed: before - botUsers.length });
});

// 1. Health check endpoint
app.get('/api/health', (_req, res) => {
  const defaultKeyAvailable = Boolean(process.env.RUNNINGHUB_API_KEY && process.env.RUNNINGHUB_API_KEY.length > 5);
  res.json({
    status: 'ok',
    hasDefaultApiKey: defaultKeyAvailable,
    timestamp: new Date().toISOString(),
  });
});

// 2. Preset Samples endpoint for quick testing
app.get('/api/runninghub/sample-presets', (_req, res) => {
  res.json([
    {
      id: 'preset-wan-1',
      title: 'Wan 2.1 High-Precision Dance',
      category: 'Wan 2.1 Motion',
      characterName: 'Cyberpunk Girl',
      imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000&auto=format&fit=crop',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      description: 'Superior character garment dynamics and precise pose retargeting with Wan 2.1',
      orientation: 'video',
      keepOriginalSound: true,
      model: 'wan-2.1',
    },
    {
      id: 'preset-wan-2',
      title: 'Wan 2.1 Cinematic Walk',
      category: 'Wan 2.1 Motion',
      characterName: 'Anime Heroine',
      imageUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?q=80&w=1000&auto=format&fit=crop',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
      description: 'Smooth full-body stride & natural physics using Alibaba Wan 2.1',
      orientation: 'image',
      keepOriginalSound: true,
      model: 'wan-2.1',
    },
    {
      id: 'preset-motion-v2-1',
      title: 'Motion V2 1080HD Dance',
      category: 'Motion V2',
      characterName: 'Action Hero',
      imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1000&auto=format&fit=crop',
      videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
      description: 'Ultra-sharp 1080p Full HD motion transfer with Motion V2 1080HD',
      orientation: 'video',
      keepOriginalSound: true,
      model: 'motion-v2',
    },
  ]);
});

// 3. Motion Control task submission proxy with multi-key pool failover & Workflow fallback
app.post('/api/runninghub/motion-control', async (req, res) => {
  try {
    const userApiKey = req.headers['x-runninghub-api-key'] as string;
    const candidates = getCandidateKeys(userApiKey);

    if (candidates.length === 0) {
      return res.status(401).json({
        error: 'Missing RunningHub API Key',
        message: 'Belum ada API Key RunningHub di Pool. Silakan masukkan API Key di Account Pool.',
      });
    }

    const {
      imageUrl,
      videoUrl,
      characterOrientation,
      model,
      prompt,
      negativePrompt,
      keepOriginalSound,
      resolution,
      qualityMode,
      styleMode,
    } = req.body;

    // Backend Security: Check model status before any processing
    if (model === 'motion-v2' && !motionV2Enabled) {
      return res.status(403).json({
        status: 'FAILED',
        error: 'Model Disabled',
        message: '🚀 Motion V2 — 1080HD saat ini sedang dinonaktifkan oleh Admin.',
      });
    }
    if (model === 'wan-2.1' && !wanEnabled) {
      return res.status(403).json({
        status: 'FAILED',
        error: 'Model Disabled',
        message: '✨ Wan 2.1 V5 saat ini sedang dinonaktifkan oleh Admin.',
      });
    }

    if (!imageUrl || !videoUrl) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Foto Karakter (imageUrl) dan Video Gerakan (videoUrl) wajib diisi.',
      });
    }

    let lastError: any = null;

    // Try candidates with balance check & auto failover
    for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
      const candidate = candidates[cIdx];
      const apiKey = candidate.key;

      // Check balance
      const statusRes = await checkAccountStatus(apiKey);
      if (statusRes.remainCoins <= 0 && statusRes.error) {
        lastError = { status: 400, message: statusRes.error };
        continue;
      }

      console.log(`[RunningHub Proxy] Submitting Motion Control task (Key: ${maskKey(apiKey)})`);

      const subRes = await executeTaskSubmission(apiKey, imageUrl, videoUrl, {
        characterOrientation,
        model,
        prompt,
        negativePrompt,
        keepOriginalSound,
        resolution: resolution || '1080p',
        qualityMode: qualityMode || 'pro',
        styleMode,
      });

      if (subRes.taskId) {
        candidate.status = 'enterprise';
        candidate.statusLabel = `🟢 Aktif (${statusRes.remainCoins} RH Coins)`;
        candidate.lastUsedAt = new Date().toISOString();
        candidate.lastError = undefined;

        return res.json({
          taskId: subRes.taskId,
          status: 'QUEUED',
          code: 0,
          msg: 'success',
          apiTypeUsed: subRes.apiTypeUsed,
          keyUsed: maskKey(apiKey),
          data: subRes.rawResponse?.data || subRes.rawResponse,
          ...subRes.rawResponse,
        });
      }

      lastError = {
        status: 400,
        message: subRes.error || 'Failed submission on all endpoints',
      };
    }

    return res.status(lastError?.status || 400).json({
      error: 'RunningHub Submission Failed',
      message: lastError?.message || 'Could not submit motion control task with available API keys.',
      details: lastError,
    });
  } catch (error: any) {
    console.error('[Server Error /api/runninghub/motion-control]', error);
    return res.status(500).json({
      error: 'Internal Proxy Error',
      message: error?.message || 'Failed to communicate with RunningHub API',
    });
  }
});

// Config endpoints for workflow management
app.get('/api/config', (_req, res) => {
  res.json({
    activeWorkflowId,
    imageNodeId,
    videoNodeId,
    autoRotateEnabled,
    models: EMBEDDED_MOTION_MODELS,
  });
});

app.get('/api/models', (_req, res) => {
  res.json({
    success: true,
    models: Object.values(EMBEDDED_MOTION_MODELS),
    defaultModel: 'motion-v2',
  });
});

app.post('/api/config/workflow', (req, res) => {
  const { workflowId, imgNodeId, vidNodeId } = req.body;
  if (workflowId && typeof workflowId === 'string') {
    activeWorkflowId = workflowId.trim();
  }
  if (imgNodeId && typeof imgNodeId === 'string') {
    imageNodeId = imgNodeId.trim();
  }
  if (vidNodeId && typeof vidNodeId === 'string') {
    videoNodeId = vidNodeId.trim();
  }
  saveBotConfig();

  res.json({
    success: true,
    activeWorkflowId,
    imageNodeId,
    videoNodeId,
  });
});

// 4. Task Query polling proxy with normalized outputs
app.post('/api/runninghub/query', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    const { taskId } = req.body;
    if (!taskId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'taskId is required to query execution status.',
      });
    }

    const candidateKeys = getCandidateKeys(apiKey);
    const keyToUse = apiKey || (candidateKeys.length > 0 ? candidateKeys[0].key : process.env.RUNNINGHUB_API_KEY || '');

    const normalized = await queryRunningHubTask(taskId, keyToUse);

    let remainCoins: number | undefined = undefined;
    if (normalized.status === 'SUCCESS') {
      try {
        const balanceRes = await checkAccountStatus(keyToUse);
        if (balanceRes && balanceRes.remainCoins !== undefined) {
          remainCoins = balanceRes.remainCoins;
        }
      } catch (err) {
        console.warn('[Query Balance Error]', err);
      }
    }

    // Return normalized format that matches RunningHubQueryResult interface directly
    return res.json({
      status: normalized.status,
      taskId: normalized.taskId,
      results: normalized.results,
      videoUrl: normalized.videoUrl,
      taskCostTime: normalized.taskCostTime,
      errorCode: normalized.errorCode,
      errorMessage: normalized.errorMessage,
      remainCoins,
      creditCost: 15,
      usage: {
        taskCostTime: normalized.taskCostTime,
        remainCoins,
        creditCost: 15,
      },
      data: normalized.raw?.data || normalized.raw,
      rawResponse: normalized.raw,
    });
  } catch (error: any) {
    console.error('[Server Error /api/runninghub/query]', error);
    return res.status(500).json({
      status: 'FAILED',
      error: 'Internal Proxy Error',
      message: error?.message || 'Failed to poll RunningHub API',
    });
  }
});

// 5. Binary Media Upload Proxy with local hosted storage fallback
app.post('/api/runninghub/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file provided',
        message: 'Please send a binary file in form-data field "file".',
      });
    }

    const apiKey = getApiKey(req);
    const originalname = req.file.originalname || `upload-${Date.now()}.mp4`;
    const mimetype = req.file.mimetype || 'application/octet-stream';
    const isVideo = originalname.toLowerCase().endsWith('.mp4') || originalname.toLowerCase().endsWith('.mov') || originalname.toLowerCase().endsWith('.webm') || mimetype.startsWith('video');
    const fileTypeParam = isVideo ? 'video' : 'image';

    // 1. Primary Strategy: Upload directly to RunningHub OpenAPI (/task/openapi/upload)
    const poolKeys = apiKeyPool.map((item) => (typeof item === 'string' ? item : item?.key));
    const candidateKeys = [apiKey, ...poolKeys].filter((k): k is string => Boolean(k && typeof k === 'string' && k.trim().length > 8));
    const uniqueKeys = Array.from(new Set(candidateKeys));

    const uploadEndpoints = [
      'https://www.runninghub.ai/task/openapi/upload',
      'https://www.runninghub.cn/task/openapi/upload',
    ];

    for (const testKey of uniqueKeys) {
      for (const endpoint of uploadEndpoints) {
        try {
          const formData = new FormData();
          formData.append('apiKey', testKey);
          formData.append('fileType', fileTypeParam);
          const blob = new Blob([req.file.buffer], { type: mimetype });
          formData.append('file', blob, originalname);

          console.log(`[RunningHub Upload] Uploading ${originalname} (${req.file.size} bytes, type=${fileTypeParam}) to ${endpoint}...`);

          const rhRes = await fetch(endpoint, {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(25000),
          });

          const rhData = await rhRes.json().catch(() => null);
          if (rhData && rhData.code === 0 && rhData.data) {
            let fileName = '';
            if (typeof rhData.data === 'string') {
              fileName = rhData.data.trim();
            } else if (typeof rhData.data === 'object') {
              fileName = (rhData.data.fileName || rhData.data.url || rhData.data.fileUrl || rhData.data.path || rhData.data.download_url || '') as string;
            }
            if (fileName && typeof fileName === 'string' && fileName.length > 3) {
              console.log(`[RunningHub Upload] ✅ Successfully uploaded to RunningHub (Key: ${testKey.slice(0, 6)}...): ${fileName}`);
              return res.json({
                code: 0,
                msg: 'success',
                data: {
                  download_url: fileName,
                  fileName: fileName,
                  size: String(req.file.size),
                },
              });
            }
          }
        } catch (rhUploadErr: any) {
          console.warn(`[RunningHub Upload] Attempt failed on ${endpoint}:`, rhUploadErr.message);
        }
      }
    }

    // 2. Reliable Hosted Media Fallback
    const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}-${originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    hostedMediaStore.set(fileId, {
      id: fileId,
      buffer: req.file.buffer,
      mimeType: mimetype,
      filename: originalname,
      createdAt: Date.now(),
    });

    const host = req.get('x-forwarded-host') || req.get('host') || `localhost:${PORT}`;
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    const hostedUrl = `${proto}://${host}/api/media/hosted/${fileId}`;

    console.log(`[Local Hosted Media] Created accessible file URL: ${hostedUrl}`);

    return res.json({
      code: 0,
      msg: 'success',
      data: {
        download_url: hostedUrl,
        fileName: originalname,
        size: String(req.file.size),
      },
    });
  } catch (error: any) {
    console.error('[Server Error /api/runninghub/upload]', error);
    return res.status(500).json({
      error: 'Upload Error',
      message: error?.message || 'Failed to process file upload',
    });
  }
});

// Setup Vite development server or production static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RunningHub Kling Motion Control Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
