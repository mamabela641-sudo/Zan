import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Bot,
  User,
  Image as ImageIcon,
  Video as VideoIcon,
  Key,
  Sliders,
  RotateCcw,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ExternalLink,
  HelpCircle,
  Upload,
} from 'lucide-react';
import { BotMessage, MotionControlTask, AppSettings, SamplePreset } from '../types';
import { submitMotionControlTask, queryTaskStatus, uploadFileToRunningHub } from '../lib/api';

interface TelegramBotViewProps {
  settings: AppSettings;
  onOpenApiKeyModal: () => void;
  onOpenSettingsModal: () => void;
  hasServerKey: boolean;
  samplePresets: SamplePreset[];
  tasks: MotionControlTask[];
  onAddTask: (task: MotionControlTask) => void;
  onUpdateTask: (taskId: string, updates: Partial<MotionControlTask>) => void;
}

export const TelegramBotView: React.FC<TelegramBotViewProps> = ({
  settings,
  onOpenApiKeyModal,
  onOpenSettingsModal,
  hasServerKey,
  samplePresets,
  tasks,
  onAddTask,
  onUpdateTask,
}) => {
  const [telegramStatus, setTelegramStatus] = useState<{
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
    botInfo: { username?: string; first_name?: string } | null;
    processedMessages: number;
    error: string | null;
  }>({
    status: 'connecting',
    botInfo: null,
    processedMessages: 0,
    error: null,
  });

  const [messages, setMessages] = useState<BotMessage[]>([
    {
      id: 'welcome-1',
      sender: 'bot',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: `🤖 Motion Control Bot\n\n🎬 KLING V3 MOTION CONTROL\nUbah foto karakter menjadi video mengikuti gerakan dari video referensi.`,
      options: [
        { label: '🔑 API KEY RUNNINGHUB', action: 'API_KEY' },
        { label: '🎬 GENERATE VIDEO', action: 'START_GENERATE' },
        { label: '⚙️ PENGATURAN', action: 'SETTINGS' },
        { label: '📜 TASK HISTORY', action: 'HISTORY' },
      ],
    },
  ]);

  const [inputMessage, setInputMessage] = useState('');
  const [currentStep, setCurrentStep] = useState<'idle' | 'awaiting_photo' | 'awaiting_video' | 'processing'>('idle');
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [activePollTaskId, setActivePollTaskId] = useState<string | null>(null);
  const [activePollMsgId, setActivePollMsgId] = useState<string | null>(null);
  const [taskStartTime, setTaskStartTime] = useState<number>(0);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const chatEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Fetch Telegram Live Bot Status
  useEffect(() => {
    const checkBotStatus = async () => {
      try {
        const res = await fetch('/api/telegram/status');
        if (res.ok) {
          const data = await res.json();
          setTelegramStatus(data);
        }
      } catch (err) {
        console.error('Error fetching Telegram bot status:', err);
      }
    };
    checkBotStatus();
    const interval = setInterval(checkBotStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, uploadingMedia]);

  // Polling for active task in Bot mode
  useEffect(() => {
    if (!activePollTaskId || !activePollMsgId) return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const elapsedSecs = Math.floor((Date.now() - (taskStartTime || Date.now())) / 1000);
      const timeStr = formatTime(elapsedSecs);

      try {
        const queryRes = await queryTaskStatus(activePollTaskId, settings.apiKey);
        const status = queryRes.status;
        const resultUrl = queryRes.videoUrl || (queryRes.results && queryRes.results.length > 0 ? queryRes.results[0].url : undefined);

        if (status === 'SUCCESS' && resultUrl) {
          clearInterval(interval);
          setActivePollTaskId(null);
          setActivePollMsgId(null);

          // Update task in parent state
          onUpdateTask(activePollTaskId, {
            status: 'SUCCESS',
            resultUrl,
            completedAt: Date.now(),
            taskCostTime: queryRes.usage?.taskCostTime,
          });

          // Update status message
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === activePollMsgId
                ? {
                    ...msg,
                    text: `✅ Motion Control BERHASIL!\n🎬 Video sudah selesai dibuat.\nTask: ${activePollTaskId}\nTotal waktu: ${timeStr}`,
                  }
                : msg
            )
          );

          // Append completion video message to bot chat
          setMessages((prev) => [
            ...prev,
            {
              id: `bot-done-${Date.now()}`,
              sender: 'bot',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              text: `✅ Motion Control BERHASIL!\n🎬 Video sudah selesai dibuat.\nTask ID: ${activePollTaskId}`,
              mediaUrl: resultUrl,
              mediaType: 'video',
              options: [
                { label: '🎬 GENERATE VIDEO LAGI', action: 'START_GENERATE' },
                { label: '🔑 API KEY RUNNINGHUB', action: 'API_KEY' },
              ],
            },
          ]);
          setCurrentStep('idle');
        } else if (status === 'FAILED') {
          clearInterval(interval);
          setActivePollTaskId(null);
          setActivePollMsgId(null);

          const errMsg = queryRes.errorMessage || 'Content verification failed or workflow execution error.';

          onUpdateTask(activePollTaskId, {
            status: 'FAILED',
            errorCode: queryRes.errorCode || '1501',
            errorMessage: errMsg,
          });

          const isEnterpriseErr =
            errMsg.includes('Enterprise-Shared') || errMsg.includes('restricted');

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === activePollMsgId
                ? {
                    ...msg,
                    text: isEnterpriseErr
                      ? `❌ Motion Control GAGAL\nError: Access Denied: Standard Model API is restricted to Enterprise-Shared API Keys only.\n🔑 API Key yang digunakan tidak memiliki akses Standard Model API.`
                      : `❌ Motion Control GAGAL\nTask: ${activePollTaskId}\nError: ${errMsg}`,
                    options: [
                      { label: '🔑 Ganti API Key', action: 'OPEN_KEY_MODAL' },
                      { label: '🔄 Coba Lagi', action: 'START_GENERATE' },
                    ],
                  }
                : msg
            )
          );
          setCurrentStep('idle');
        } else {
          // Still in progress: QUEUED or RUNNING
          const statusLabel =
            status === 'QUEUED' || attempts <= 1
              ? '🟡 QUEUED — task sudah diterima RunningHub, menunggu giliran'
              : '🔵 RUNNING — Kling sedang generate';

          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === activePollMsgId
                ? {
                    ...msg,
                    text: `⏳ Motion Control sedang diproses\nStatus: ${statusLabel}\nTask: ${activePollTaskId}\nWaktu berjalan: ${timeStr}\nMohon tunggu...`,
                  }
                : msg
            )
          );
        }
      } catch (err: any) {
        console.error('Error polling bot task status:', err);
      }
    }, settings.pollIntervalMs || 4000);

    return () => clearInterval(interval);
  }, [activePollTaskId, activePollMsgId, taskStartTime, settings.apiKey, settings.pollIntervalMs]);

  const handleSendMessage = (customText?: string) => {
    const textToSend = customText || inputMessage.trim();
    if (!textToSend) return;

    // Add user message
    const userMsg: BotMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: textToSend,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputMessage('');

    // Handle command inputs
    const lower = textToSend.toLowerCase();
    if (lower === '/start' || lower === 'start') {
      triggerWelcomeBotMessage();
    } else if (lower.includes('key') || lower === '/key') {
      handleBotAction('API_KEY');
    } else if (lower.includes('generate') || lower === '/generate') {
      handleBotAction('START_GENERATE');
    } else if (lower.startsWith('http://') || lower.startsWith('https://')) {
      // Direct URL paste handler
      if (currentStep === 'awaiting_photo') {
        handlePhotoSelected(textToSend);
      } else if (currentStep === 'awaiting_video') {
        handleVideoSelected(textToSend);
      } else {
        // Auto infer if image or video
        if (textToSend.match(/\.(mp4|webm|mov|avi)$/i)) {
          handleVideoSelected(textToSend);
        } else {
          handlePhotoSelected(textToSend);
        }
      }
    } else {
      // Default conversational response
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-reply-${Date.now()}`,
            sender: 'bot',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            text: `Silakan pilih menu di bawah ini untuk memulai Motion Control Kling V3:`,
            options: [
              { label: '🎬 GENERATE VIDEO', action: 'START_GENERATE' },
              { label: '🔑 API KEY RUNNINGHUB', action: 'API_KEY' },
            ],
          },
        ]);
      }, 500);
    }
  };

  const triggerWelcomeBotMessage = () => {
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-welcome-${Date.now()}`,
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `🤖 Motion Control Bot\n\n🎬 KLING V3 MOTION CONTROL\nUbah foto karakter menjadi video mengikuti gerakan dari video referensi.`,
          options: [
            { label: '🔑 API KEY RUNNINGHUB', action: 'API_KEY' },
            { label: '🎬 GENERATE VIDEO', action: 'START_GENERATE' },
            { label: '⚙️ PENGATURAN', action: 'SETTINGS' },
            { label: '📜 TASK HISTORY', action: 'HISTORY' },
          ],
        },
      ]);
    }, 400);
  };

  const handleBotAction = (action: string) => {
    if (action === 'API_KEY') {
      const hasKey = Boolean((settings.apiKey && settings.apiKey.trim()) || hasServerKey);
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-key-${Date.now()}`,
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `🔐 RunningHub API Key\n\n${
            hasKey
              ? `> ✅ API Key tersimpan\nStatus: 🟢 Terhubung\nKey: ••••••••••••••••\n\nKey akan digunakan untuk menjalankan Motion Control dari akun RunningHub Anda.`
              : `> ⚠️ Belum ada API Key\nMasukkan API Key RunningHub Anda untuk memproses video.`
          }`,
          options: [
            { label: '➕ Masukkan API Key', action: 'OPEN_KEY_MODAL' },
            { label: '🎬 GENERATE VIDEO', action: 'START_GENERATE' },
          ],
        },
      ]);
    } else if (action === 'OPEN_KEY_MODAL') {
      onOpenApiKeyModal();
    } else if (action === 'SETTINGS') {
      onOpenSettingsModal();
    } else if (action === 'HISTORY') {
      const historyText =
        tasks.length === 0
          ? `📜 TASK HISTORY\nBelum ada tugas video yang dibuat.`
          : `📜 TASK HISTORY (${tasks.length} total):\n\n` +
            tasks
              .slice(0, 5)
              .map(
                (t, idx) =>
                  `${idx + 1}. Task ID: ${t.taskId.slice(-8)}\nStatus: ${t.status} | Created: ${new Date(
                    t.createdAt
                  ).toLocaleTimeString()}`
              )
              .join('\n\n');

      setMessages((prev) => [
        ...prev,
        {
          id: `bot-history-${Date.now()}`,
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: historyText,
          options: [
            { label: '🎬 GENERATE VIDEO', action: 'START_GENERATE' },
            { label: '🔑 API KEY RUNNINGHUB', action: 'API_KEY' },
          ],
        },
      ]);
    } else if (action === 'START_GENERATE') {
      setCurrentStep('awaiting_photo');
      setSelectedPhotoUrl(null);
      setSelectedVideoUrl(null);

      setMessages((prev) => [
        ...prev,
        {
          id: `bot-step1-${Date.now()}`,
          sender: 'bot',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `📸 Langkah 1/2\nKirim 1 foto karakter.\n\nAtau pilih dari sampel preset di bawah ini:`,
          options: samplePresets.slice(0, 3).map((preset) => ({
            label: `🖼️ ${preset.characterName}`,
            action: `PRESET_PHOTO_${preset.id}`,
          })),
        },
      ]);
    } else if (action.startsWith('PRESET_PHOTO_')) {
      const presetId = action.replace('PRESET_PHOTO_', '');
      const preset = samplePresets.find((p) => p.id === presetId);
      if (preset) {
        handlePhotoSelected(preset.imageUrl, preset.characterName);
      }
    } else if (action.startsWith('PRESET_VIDEO_')) {
      const presetId = action.replace('PRESET_VIDEO_', '');
      const preset = samplePresets.find((p) => p.id === presetId);
      if (preset) {
        handleVideoSelected(preset.videoUrl, preset.title);
      }
    }
  };

  const handlePhotoSelected = (photoUrl: string, title?: string) => {
    setSelectedPhotoUrl(photoUrl);
    setCurrentStep('awaiting_video');

    setMessages((prev) => [
      ...prev,
      {
        id: `user-photo-${Date.now()}`,
        sender: 'user',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `[Foto Karakter] ${title || photoUrl.slice(-20)}`,
        mediaUrl: photoUrl,
        mediaType: 'image',
      },
      {
        id: `bot-step2-${Date.now()}`,
        sender: 'bot',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `✅ Foto diterima.\n\n🎥 Langkah 2/2\nSekarang kirim video gerakan.\n• Durasi: 3–30 detik\n• Maksimum: 100 MB\n\nAtau pilih sampel gerakan:`,
        options: samplePresets.slice(0, 3).map((preset) => ({
          label: `💃 ${preset.title}`,
          action: `PRESET_VIDEO_${preset.id}`,
        })),
      },
    ]);
  };

  const handleVideoSelected = async (videoUrl: string, title?: string) => {
    setSelectedVideoUrl(videoUrl);
    setCurrentStep('processing');

    const photoUrl = selectedPhotoUrl || samplePresets[0].imageUrl;

    const processingMsgId = `bot-processing-${Date.now()}`;
    const startTime = Date.now();
    setTaskStartTime(startTime);
    setActivePollMsgId(processingMsgId);

    setMessages((prev) => [
      ...prev,
      {
        id: `user-video-${Date.now()}`,
        sender: 'user',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `[Video Gerakan] ${title || videoUrl.slice(-20)}`,
        mediaUrl: videoUrl,
        mediaType: 'video',
      },
      {
        id: processingMsgId,
        sender: 'bot',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `⏳ Motion Control sedang diproses\nStatus: 🟡 UPLOADING — foto/video sedang dikirim ke RunningHub\nWaktu berjalan: 00:00\nMohon tunggu...`,
      },
    ]);

    // Submit motion control job
    try {
      const submitRes = await submitMotionControlTask(
        {
          imageUrl: photoUrl,
          videoUrl,
          characterOrientation: settings.defaultOrientation || 'video',
          keepOriginalSound: settings.defaultKeepOriginalSound,
        },
        settings.apiKey
      );

      if (submitRes.taskId) {
        const newTask: MotionControlTask = {
          id: `task-${Date.now()}`,
          taskId: submitRes.taskId,
          status: 'RUNNING',
          imageUrl: photoUrl,
          videoUrl,
          characterOrientation: settings.defaultOrientation || 'video',
          keepOriginalSound: settings.defaultKeepOriginalSound,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        onAddTask(newTask);

        // Update status message to QUEUED
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === processingMsgId
              ? {
                  ...msg,
                  text: `⏳ Motion Control sedang diproses\nStatus: 🟡 QUEUED — task sudah diterima RunningHub, menunggu giliran\nTask: ${submitRes.taskId}\nWaktu berjalan: 00:02\nMohon tunggu...`,
                }
              : msg
          )
        );

        setActivePollTaskId(submitRes.taskId);
      } else {
        throw new Error(submitRes.errorMessage || 'Task submission failed');
      }
    } catch (err: any) {
      console.error('Error submitting motion control task in bot:', err);
      const errMsg = err.message || '';
      const isEnterpriseErr = errMsg.includes('Enterprise-Shared') || errMsg.includes('restricted');

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === processingMsgId
            ? {
                ...msg,
                text: isEnterpriseErr
                  ? `❌ Motion Control GAGAL\nError: Access Denied: Standard Model API is restricted to Enterprise-Shared API Keys only.\n🔑 API Key yang digunakan tidak memiliki akses Standard Model API.`
                  : `❌ Motion Control GAGAL\nError: ${errMsg || 'Check RunningHub API Key & file parameters.'}`,
                options: [
                  { label: '🔑 Ganti API Key', action: 'OPEN_KEY_MODAL' },
                  { label: '🔄 Coba Lagi', action: 'START_GENERATE' },
                ],
              }
            : msg
        )
      );
      setCurrentStep('idle');
      setActivePollMsgId(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingMedia(true);
    try {
      const uploaded = await uploadFileToRunningHub(file, settings.apiKey);
      const fileUrl = uploaded.download_url.startsWith('http')
        ? uploaded.download_url
        : `https://www.runninghub.ai/${uploaded.download_url}`;

      if (type === 'image') {
        handlePhotoSelected(fileUrl, file.name);
      } else {
        handleVideoSelected(fileUrl, file.name);
      }
    } catch (err: any) {
      // Fallback to local Data URL object preview
      const objectUrl = URL.createObjectURL(file);
      if (type === 'image') {
        handlePhotoSelected(objectUrl, file.name);
      } else {
        handleVideoSelected(objectUrl, file.name);
      }
    } finally {
      setUploadingMedia(false);
      e.target.value = '';
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-2 sm:px-4 py-4 h-[calc(100vh-5rem)] flex flex-col">
      {/* Telegram Chat Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl p-3 sm:p-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-md">
              <Bot className="w-6 h-6" />
            </div>
            <span
              className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-900 ${
                telegramStatus.status === 'connected'
                  ? 'bg-emerald-500'
                  : telegramStatus.status === 'connecting'
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
            ></span>
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white flex items-center space-x-1.5">
              <span>{telegramStatus.botInfo?.first_name || 'RunningHub Kling V3 Bot'}</span>
              <span className="text-[10px] bg-blue-950 text-blue-300 border border-blue-800 px-1.5 py-0.5 rounded-full font-mono">
                @{telegramStatus.botInfo?.username || 'bot'}
              </span>
            </h2>
            <p className="text-xs text-slate-400 flex items-center space-x-1.5">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  telegramStatus.status === 'connected' ? 'bg-emerald-400' : 'bg-slate-500'
                }`}
              ></span>
              <span>
                {telegramStatus.status === 'connected'
                  ? 'Live Telegram Bot Online'
                  : telegramStatus.status === 'connecting'
                  ? 'Connecting to Telegram...'
                  : 'Bot Offline'}
              </span>
              {telegramStatus.processedMessages > 0 && (
                <span className="text-[10px] text-cyan-400 font-mono">
                  • {telegramStatus.processedMessages} msgs
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {telegramStatus.botInfo?.username && (
            <a
              href={`https://t.me/${telegramStatus.botInfo.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 text-xs bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 rounded-lg flex items-center space-x-1 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Open in Telegram</span>
            </a>
          )}
          <button
            onClick={triggerWelcomeBotMessage}
            className="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 flex items-center space-x-1 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset /start</span>
          </button>
        </div>
      </div>

      {/* Telegram Chat Body */}
      <div className="flex-1 bg-slate-950/90 border-x border-slate-800 overflow-y-auto p-3 sm:p-5 space-y-4 font-sans">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div className="flex items-end space-x-2 max-w-[88%] sm:max-w-[78%]">
              {msg.sender === 'bot' && (
                <div className="w-7 h-7 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0 mb-1">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`p-3.5 rounded-2xl shadow-md text-xs sm:text-sm space-y-2 ${
                  msg.sender === 'user'
                    ? 'bg-blue-600 text-white rounded-br-none'
                    : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none'
                }`}
              >
                {msg.text && (
                  <div className="whitespace-pre-wrap leading-relaxed font-sans">{msg.text}</div>
                )}

                {msg.mediaUrl && (
                  <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 max-w-xs">
                    {msg.mediaType === 'image' ? (
                      <img
                        src={msg.mediaUrl}
                        alt="Media payload"
                        className="w-full h-auto max-h-48 object-cover"
                      />
                    ) : (
                      <video
                        src={msg.mediaUrl}
                        controls
                        className="w-full h-auto max-h-56 object-cover"
                      />
                    )}
                  </div>
                )}

                <div
                  className={`text-[10px] text-right font-mono opacity-60 ${
                    msg.sender === 'user' ? 'text-blue-100' : 'text-slate-400'
                  }`}
                >
                  {msg.timestamp}
                </div>
              </div>
            </div>

            {/* Telegram Bot Inline Keyboard Options */}
            {msg.options && msg.options.length > 0 && (
              <div className="mt-2.5 pl-9 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-[85%]">
                {msg.options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => handleBotAction(opt.action)}
                    className="px-3 py-2 bg-slate-900/90 hover:bg-slate-800 text-cyan-300 hover:text-white border border-cyan-800/60 hover:border-cyan-500 rounded-xl text-xs font-semibold shadow-sm transition-all text-left flex items-center justify-between group"
                  >
                    <span>{opt.label}</span>
                    <Sparkles className="w-3 h-3 text-cyan-500 group-hover:scale-110 transition-transform" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {uploadingMedia && (
          <div className="flex items-center space-x-2 pl-9 text-xs text-cyan-400 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 w-max animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Mengunggah media ke RunningHub...</span>
          </div>
        )}

        {activePollTaskId && (
          <div className="pl-9 my-2">
            <div className="bg-slate-900/90 border border-cyan-800/80 p-3.5 rounded-2xl max-w-xs text-xs space-y-2">
              <div className="flex items-center justify-between text-cyan-300 font-semibold">
                <span className="flex items-center space-x-2">
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                  <span>Kling V3 Processing</span>
                </span>
                <span className="font-mono text-[10px] bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800">
                  {activePollTaskId.slice(-6)}
                </span>
              </div>
              <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full w-2/3 animate-pulse"></div>
              </div>
              <p className="text-[11px] text-slate-400">Task status: RUNNING (Memproses pose & gerakan...)</p>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={imageInputRef}
        accept="image/*"
        onChange={(e) => handleFileUpload(e, 'image')}
        className="hidden"
      />
      <input
        type="file"
        ref={videoInputRef}
        accept="video/mp4,video/webm,video/quicktime"
        onChange={(e) => handleFileUpload(e, 'video')}
        className="hidden"
      />

      {/* Chat Action Footer */}
      <div className="bg-slate-900 border-x border-b border-slate-800 rounded-b-2xl p-3 space-y-2">
        {currentStep === 'awaiting_photo' && (
          <div className="flex items-center space-x-2 bg-slate-950 p-2 rounded-xl border border-amber-800/60 text-xs text-amber-300">
            <Upload className="w-4 h-4 shrink-0 text-amber-400" />
            <span className="flex-1">Kirim 1 foto karakter via tombol upload atau tempel URL:</span>
            <button
              onClick={() => imageInputRef.current?.click()}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-xs transition-colors"
            >
              Upload Foto
            </button>
          </div>
        )}

        {currentStep === 'awaiting_video' && (
          <div className="flex items-center space-x-2 bg-slate-950 p-2 rounded-xl border border-cyan-800/60 text-xs text-cyan-300">
            <Upload className="w-4 h-4 shrink-0 text-cyan-400" />
            <span className="flex-1">Kirim 1 video gerakan (3-30s) atau tempel URL MP4:</span>
            <button
              onClick={() => videoInputRef.current?.click()}
              className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg text-xs transition-colors"
            >
              Upload Video
            </button>
          </div>
        )}

        <div className="flex items-center space-x-2">
          <button
            onClick={() => imageInputRef.current?.click()}
            className="p-2.5 text-slate-400 hover:text-white bg-slate-950 hover:bg-slate-800 rounded-xl border border-slate-800 transition-colors"
            title="Upload Character Photo"
          >
            <ImageIcon className="w-4 h-4" />
          </button>

          <button
            onClick={() => videoInputRef.current?.click()}
            className="p-2.5 text-slate-400 hover:text-white bg-slate-950 hover:bg-slate-800 rounded-xl border border-slate-800 transition-colors"
            title="Upload Driving Video"
          >
            <VideoIcon className="w-4 h-4" />
          </button>

          <input
            id="input-telegram-message"
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Type /start, /generate, or paste image/video URL..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />

          <button
            id="btn-telegram-send"
            onClick={() => handleSendMessage()}
            className="p-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl shadow-lg shadow-cyan-600/30 transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
