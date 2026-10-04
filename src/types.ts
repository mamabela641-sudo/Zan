export type OrientationMode = 'image' | 'video';
export type MotionModelType = 'motion-v2' | 'wan-2.1';

export type ResolutionMode = '1080p' | '720p';
export type QualityMode = 'pro' | 'std';

export interface MotionControlPayload {
  imageUrl: string;
  videoUrl: string;
  characterOrientation: OrientationMode;
  model?: MotionModelType;
  prompt?: string | null;
  negativePrompt?: string | null;
  keepOriginalSound?: boolean;
  resolution?: ResolutionMode;
  qualityMode?: QualityMode;
  styleMode?: string;
  elementList?: Array<{ element_id: string; [key: string]: any }>;
}

export interface RunningHubSubmitResponse {
  taskId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | string;
  errorCode?: string;
  errorMessage?: string;
  results?: Array<{
    url: string;
    nodeId?: string;
    outputType?: string;
    text?: string | null;
  }> | null;
  clientId?: string;
  promptTips?: string;
}

export interface RunningHubQueryResult {
  taskId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | string;
  videoUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  remainCoins?: number;
  creditCost?: number;
  failedReason?: Record<string, any>;
  usage?: {
    consumeMoney?: string | null;
    consumeCoins?: string | null;
    taskCostTime?: string;
    thirdPartyConsumeMoney?: string | null;
    remainCoins?: number;
    creditCost?: number;
  };
  results?: Array<{
    url: string;
    nodeId?: string;
    outputType?: string;
    text?: string | null;
  }> | null;
  clientId?: string;
  promptTips?: string;
}

export interface MotionControlTask {
  id: string;
  taskId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED';
  imageUrl: string;
  videoUrl: string;
  characterOrientation: OrientationMode;
  model?: MotionModelType;
  prompt?: string;
  negativePrompt?: string;
  keepOriginalSound: boolean;
  resolution?: ResolutionMode;
  qualityMode?: QualityMode;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  taskCostTime?: string;
  resultUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  remainCoins?: number;
  creditCost?: number;
  rawResponse?: any;
}

export interface SamplePreset {
  id: string;
  title: string;
  category: string;
  characterName: string;
  imageUrl: string;
  videoUrl: string;
  description: string;
  orientation: OrientationMode;
  keepOriginalSound: boolean;
  recommendedModel?: MotionModelType;
}

export interface BotMessage {
  id: string;
  sender: 'bot' | 'user';
  text?: string;
  timestamp: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  options?: Array<{
    label: string;
    action: string;
    variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  }>;
  taskStatus?: {
    taskId: string;
    status: string;
    elapsedSeconds: number;
    resultUrl?: string;
    error?: string;
  };
}

export type UserRole = 'admin' | 'user';
export type UserAccessStatus = 'active' | 'pending' | 'blocked';

export interface TelegramBotUser {
  id: number;
  chatId: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  role: UserRole;
  status: UserAccessStatus;
  requestedAt: string;
  approvedAt?: string;
  approvedBy?: number;
  rejectedAt?: string;
  blockedAt?: string;
  lastActiveAt?: string;
  generatedCount: number;
}

export interface AppSettings {
  apiKey: string;
  pollIntervalMs: number;
  defaultOrientation: OrientationMode;
  defaultModel: MotionModelType;
  defaultKeepOriginalSound: boolean;
  defaultResolution?: ResolutionMode;
  defaultQualityMode?: QualityMode;
  autoDownloadVideo: boolean;
  notifyOnCompletion: boolean;
}

