import {
  AppSettings,
  MotionControlPayload,
  MotionControlTask,
  RunningHubQueryResult,
  RunningHubSubmitResponse,
  SamplePreset,
} from '../types';

const SETTINGS_KEY = 'runninghub_kling_settings';
const TASKS_KEY = 'runninghub_kling_tasks';

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  pollIntervalMs: 4000,
  defaultOrientation: 'video',
  defaultModel: 'motion-v2',
  defaultKeepOriginalSound: true,
  defaultResolution: '1080p',
  defaultQualityMode: 'pro',
  autoDownloadVideo: false,
  notifyOnCompletion: true,
};

export function getStoredSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = getStoredSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  return updated;
}

export function getStoredTasks(): MotionControlTask[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

export function saveTasks(tasks: MotionControlTask[]): void {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

export async function checkServerHealth(): Promise<{ status: string; hasDefaultApiKey: boolean }> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { status: 'error', hasDefaultApiKey: false };
    return await res.json();
  } catch (e) {
    return { status: 'offline', hasDefaultApiKey: false };
  }
}

export async function fetchPresets(): Promise<SamplePreset[]> {
  try {
    const res = await fetch('/api/runninghub/sample-presets');
    if (!res.ok) throw new Error('Failed to fetch presets');
    return await res.json();
  } catch (e) {
    // Fallback static presets
    return [
      {
        id: 'preset-1',
        title: 'K-Pop Dance Motion',
        category: 'Dance',
        characterName: 'Cyberpunk Model',
        imageUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000&auto=format&fit=crop',
        videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        description: 'Dynamic dance motion transfer onto character reference',
        orientation: 'video',
        keepOriginalSound: true,
      },
      {
        id: 'preset-2',
        title: '3D Anime Walk',
        category: 'Anime',
        characterName: 'Anime Heroine',
        imageUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?q=80&w=1000&auto=format&fit=crop',
        videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
        description: 'Smooth movement transfer for stylized characters',
        orientation: 'image',
        keepOriginalSound: false,
      },
      {
        id: 'preset-3',
        title: 'Martial Arts Kick',
        category: 'Action',
        characterName: 'Action Figure',
        imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1000&auto=format&fit=crop',
        videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
        description: 'Full body action transfer with motion control',
        orientation: 'video',
        keepOriginalSound: true,
      },
    ];
  }
}

export async function submitMotionControlTask(
  payload: MotionControlPayload,
  apiKeyOverride?: string
): Promise<RunningHubSubmitResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const keyToUse = apiKeyOverride?.trim() || getStoredSettings().apiKey?.trim();
  if (keyToUse) {
    headers['X-RunningHub-Api-Key'] = keyToUse;
  }

  const res = await fetch('/api/runninghub/motion-control', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }

  return data;
}

export async function queryTaskStatus(
  taskId: string,
  apiKeyOverride?: string
): Promise<RunningHubQueryResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const keyToUse = apiKeyOverride?.trim() || getStoredSettings().apiKey?.trim();
  if (keyToUse) {
    headers['X-RunningHub-Api-Key'] = keyToUse;
  }

  const res = await fetch('/api/runninghub/query', {
    method: 'POST',
    headers,
    body: JSON.stringify({ taskId }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }

  return data;
}

export async function uploadFileToRunningHub(
  file: File,
  apiKeyOverride?: string
): Promise<{ download_url: string; fileName: string; size: string }> {
  const keyToUse = apiKeyOverride?.trim() || getStoredSettings().apiKey?.trim();
  const formData = new FormData();
  formData.append('file', file);

  const headers: Record<string, string> = {};
  if (keyToUse) {
    headers['X-RunningHub-Api-Key'] = keyToUse;
  }

  const res = await fetch('/api/runninghub/upload', {
    method: 'POST',
    headers,
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || data.code !== 0) {
    throw new Error(data?.message || data?.error || 'Failed to upload media to RunningHub');
  }

  return data.data;
}

export interface ApiKeyPoolItemUI {
  id: string;
  key: string;
  maskedKey: string;
  status: 'enterprise' | 'non_enterprise' | 'invalid' | 'unverified';
  statusLabel: string;
  addedAt: string;
  lastUsedAt?: string;
  lastError?: string;
}

export async function fetchApiKeyPool(): Promise<{ keys: ApiKeyPoolItemUI[]; autoRotate: boolean }> {
  const res = await fetch('/api/keys');
  if (!res.ok) throw new Error('Failed to fetch API key pool');
  return res.json();
}

export async function addKeyToPool(key: string): Promise<{ keys: ApiKeyPoolItemUI[]; keyItem: ApiKeyPoolItemUI }> {
  const res = await fetch('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to add key to pool');
  return data;
}

export async function bulkImportKeysToPool(keysText: string): Promise<{
  keys: ApiKeyPoolItemUI[];
  summary: { total: number; enterpriseCount: number; nonEnterpriseCount: number; invalidCount: number };
}> {
  const res = await fetch('/api/keys/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keysText }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to bulk import keys');
  return data;
}

export async function deleteKeyFromPool(id: string): Promise<{ keys: ApiKeyPoolItemUI[] }> {
  const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to delete key from pool');
  return data;
}

export async function verifyAllKeysInPool(): Promise<{ keys: ApiKeyPoolItemUI[] }> {
  const res = await fetch('/api/keys/verify-all', {
    method: 'POST',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to verify keys');
  return data;
}

export async function toggleAutoRotate(enabled?: boolean): Promise<{ autoRotate: boolean }> {
  const res = await fetch('/api/keys/toggle-auto-rotate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to toggle auto rotate');
  return data;
}
