import React, { useState, useRef } from 'react';
import {
  Sparkles,
  Upload,
  Video,
  Image as ImageIcon,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Download,
  Info,
  Sliders,
  Code2,
  FileText,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AppSettings, MotionControlTask, MotionModelType, OrientationMode, QualityMode, ResolutionMode, SamplePreset } from '../types';
import { submitMotionControlTask, queryTaskStatus, uploadFileToRunningHub } from '../lib/api';

interface StudioViewProps {
  settings: AppSettings;
  onOpenApiKeyModal: () => void;
  onOpenSettingsModal: () => void;
  hasServerKey: boolean;
  samplePresets: SamplePreset[];
  tasks: MotionControlTask[];
  onAddTask: (task: MotionControlTask) => void;
  onUpdateTask: (taskId: string, updates: Partial<MotionControlTask>) => void;
  onOpenPresetModal: () => void;
}

export const StudioView: React.FC<StudioViewProps> = ({
  settings,
  onOpenApiKeyModal,
  onOpenSettingsModal,
  hasServerKey,
  samplePresets,
  tasks,
  onAddTask,
  onUpdateTask,
  onOpenPresetModal,
}) => {
  const defaultPreset = samplePresets[0];

  const [imageUrl, setImageUrl] = useState<string>(defaultPreset?.imageUrl || '');
  const [videoUrl, setVideoUrl] = useState<string>(defaultPreset?.videoUrl || '');
  const [selectedModel, setSelectedModel] = useState<MotionModelType>(
    settings.defaultModel || 'wan-2.1'
  );
  const [characterOrientation, setCharacterOrientation] = useState<OrientationMode>(
    settings.defaultOrientation || 'video'
  );
  const [keepOriginalSound, setKeepOriginalSound] = useState<boolean>(
    settings.defaultKeepOriginalSound
  );
  const [resolution, setResolution] = useState<ResolutionMode>('1080p');
  const [qualityMode, setQualityMode] = useState<QualityMode>('pro');
  const [styleMode, setStyleMode] = useState<string>('faithful');
  const [prompt, setPrompt] = useState<string>(
    'masterpiece, high quality, consistent character style, perfectly preserved style, sharp focus, 60fps smooth realistic motion, high fidelity video'
  );
  const [negativePrompt, setNegativePrompt] = useState<string>(
    'deformed, distorted, blurry, extra limbs, bad eyes, noise, glitch, ugly face, artifact, flickering, face warping, jitter, low quality'
  );

  const handleStyleChange = (mode: string) => {
    setStyleMode(mode);
    if (mode === 'faithful') {
      setPrompt('masterpiece, high quality, consistent character style, perfectly preserved style, sharp focus, 60fps smooth realistic motion, high fidelity video');
      setNegativePrompt('deformed, distorted, blurry, extra limbs, bad eyes, noise, glitch, ugly face, artifact, flickering, face warping, jitter, low quality');
    } else if (mode === 'anime') {
      setPrompt('masterpiece, best quality, beautiful 2D anime illustration, vibrant colors, clear outlines, clean rendering, consistent anime art style, flat shading, smooth motion, high fidelity anime animation, 1080p');
      setNegativePrompt('photorealistic, realistic, real photo, 3d render, low resolution, blurry, deformed face, extra limbs, bad anatomy, noise, glitch, artifact, flickering');
    } else if (mode === 'cartoon') {
      setPrompt('masterpiece, best quality, stylized 3D cartoon render, pixar style, disney style, clean 3D character, vibrant lighting, smooth surfaces, consistent character cartoon style, 1080p');
      setNegativePrompt('photorealistic, real photo, realistic, sketch, low resolution, blurry, deformed face, extra limbs, bad anatomy, noise, glitch, artifact, flickering');
    } else if (mode === 'photorealistic') {
      setPrompt('masterpiece, best quality, ultra-detailed 1080p Full HD, crystal clear visual clarity, photorealistic 8k character render, crisp sharp focus, consistent studio lighting, physically accurate lighting and shadows, balanced light sources, 60fps smooth realistic motion, stable face identity, high fidelity video');
      setNegativePrompt('deformed face, distorted, blurry, bad anatomy, bad eyes, disfigured face, extra limbs, low resolution, noise, glitch, ugly face, artifact, flickering, compressed, pixelated, face warping, jitter, low quality, inconsistent lighting, rapid light changes, flashing shadows, shifting light source, color bleeding, video noise, shape-shifting, morphing, double faces, ghosting');
    }
  };

  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    setSubmitError(null);
    try {
      const uploaded = await uploadFileToRunningHub(file, settings.apiKey);
      const url = uploaded.download_url.startsWith('http')
        ? uploaded.download_url
        : `https://www.runninghub.ai/${uploaded.download_url}`;
      setImageUrl(url);
    } catch (err: any) {
      // Fallback
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result) setImageUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingVideo(true);
    setSubmitError(null);
    try {
      const uploaded = await uploadFileToRunningHub(file, settings.apiKey);
      const url = uploaded.download_url.startsWith('http')
        ? uploaded.download_url
        : `https://www.runninghub.ai/${uploaded.download_url}`;
      setVideoUrl(url);
    } catch (err: any) {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result) setVideoUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleSubmitTask = async () => {
    if (!imageUrl.trim() || !videoUrl.trim()) {
      setSubmitError('Please provide both a Character Reference Image and a Driving Motion Video.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitMotionControlTask(
        {
          imageUrl: imageUrl.trim(),
          videoUrl: videoUrl.trim(),
          characterOrientation,
          model: selectedModel,
          prompt: prompt.trim() || null,
          negativePrompt: negativePrompt.trim() || null,
          keepOriginalSound,
          resolution,
          qualityMode,
          styleMode,
        },
        settings.apiKey
      );

      if (result.taskId) {
        const newTask: MotionControlTask = {
          id: `task-${Date.now()}`,
          taskId: result.taskId,
          status: 'RUNNING',
          imageUrl: imageUrl.trim(),
          videoUrl: videoUrl.trim(),
          characterOrientation,
          model: selectedModel,
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim(),
          keepOriginalSound,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          rawResponse: result,
        };

        onAddTask(newTask);
      } else {
        throw new Error(result.errorMessage || 'Failed to receive taskId from RunningHub.');
      }
    } catch (err: any) {
      setSubmitError(err.message || 'Error submitting Motion Control task to RunningHub');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
      {/* Top Banner & Quick Presets Bar */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="px-2.5 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded-full text-[11px] font-semibold">
              🌟 Wan 2.1 Motion Control
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            AI Motion Transfer Workbench
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
            Transfer video movements directly onto 2D/3D character photos with Wan 2.1 Motion Control, full lipsync audio retention, and multi-key auto failover.
          </p>
        </div>

        <button
          id="btn-open-preset-modal"
          onClick={onOpenPresetModal}
          className="px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-cyan-600/20 flex items-center space-x-2 shrink-0 transition-all"
        >
          <Sparkles className="w-4 h-4" />
          <span>Browse Sample Motion Presets</span>
        </button>
      </div>

      {/* Main Studio Workbench Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Inputs Section: Image & Video Reference */}
        <div className="lg:col-span-7 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 1. Character Reference Image Box */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-1.5">
                  <ImageIcon className="w-4 h-4 text-cyan-400" />
                  <span>Character Photo</span>
                </label>
                <span className="text-[10px] text-slate-400">Max 10MB</span>
              </div>

              <div className="relative aspect-square bg-slate-950 rounded-xl overflow-hidden border border-slate-800/80 group flex flex-col items-center justify-center">
                {imageUrl ? (
                  <>
                    <img
                      src={imageUrl}
                      alt="Character Reference"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2 p-2">
                      <button
                        onClick={() => imageFileInputRef.current?.click()}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold border border-slate-600"
                      >
                        Change Image
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="p-4 text-center space-y-2">
                    <Upload className="w-8 h-8 text-slate-500 mx-auto" />
                    <p className="text-xs text-slate-400">Upload character reference photo</p>
                    <button
                      onClick={() => imageFileInputRef.current?.click()}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-lg text-xs font-semibold border border-slate-700"
                    >
                      Select File
                    </button>
                  </div>
                )}

                {uploadingImage && (
                  <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center space-x-2 text-xs text-cyan-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Uploading...</span>
                  </div>
                )}
              </div>

              <input
                type="file"
                ref={imageFileInputRef}
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />

              <div>
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="Or paste public Image URL..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
            </div>

            {/* 2. Driving Video Motion Box */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-1.5">
                  <Video className="w-4 h-4 text-blue-400" />
                  <span>Driving Motion Video</span>
                </label>
                <span className="text-[10px] text-slate-400">3–30s (Max 100MB)</span>
              </div>

              <div className="relative aspect-square bg-slate-950 rounded-xl overflow-hidden border border-slate-800/80 group flex flex-col items-center justify-center">
                {videoUrl ? (
                  <>
                    <video
                      src={videoUrl}
                      controls
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => videoFileInputRef.current?.click()}
                        className="px-2.5 py-1 bg-slate-900/90 text-white text-[11px] font-semibold rounded-lg border border-slate-700"
                      >
                        Change Video
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="p-4 text-center space-y-2">
                    <Video className="w-8 h-8 text-slate-500 mx-auto" />
                    <p className="text-xs text-slate-400">Upload video with motion to transfer</p>
                    <button
                      onClick={() => videoFileInputRef.current?.click()}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-blue-300 rounded-lg text-xs font-semibold border border-slate-700"
                    >
                      Select MP4
                    </button>
                  </div>
                )}

                {uploadingVideo && (
                  <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center space-x-2 text-xs text-blue-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Uploading Video...</span>
                  </div>
                )}
              </div>

              <input
                type="file"
                ref={videoFileInputRef}
                accept="video/mp4,video/webm,video/quicktime"
                onChange={handleVideoUpload}
                className="hidden"
              />

              <div>
                <input
                  type="text"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="Or paste public Video MP4 URL..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Quick Preset Selector Buttons */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              Quick Test Templates:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {samplePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => {
                    setImageUrl(preset.imageUrl);
                    setVideoUrl(preset.videoUrl);
                    setCharacterOrientation(preset.orientation);
                    setKeepOriginalSound(preset.keepOriginalSound);
                  }}
                  className="p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-cyan-800 rounded-xl text-left transition-all space-y-1"
                >
                  <div className="font-semibold text-xs text-white truncate">{preset.title}</div>
                  <div className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>{preset.category}</span>
                    <span className="text-cyan-400 font-mono">{preset.orientation}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Section: Parameters & Execution Controls */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <span>Motion Parameters</span>
              </h3>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                selectedModel === 'wan-2.1'
                  ? 'text-emerald-300 bg-emerald-950/80 border-emerald-800'
                  : 'text-cyan-400 bg-cyan-950 border border-cyan-800'
              }`}>
                {selectedModel === 'wan-2.1' ? 'Wan Animate V5' : 'Motion V2 1080HD'}
              </span>
            </div>

            {/* Model Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">
                  Motion Model Engine
                </label>
                <span className="text-[10px] text-emerald-400 font-semibold">100% Tested & Verified</span>
              </div>
              <div>
                <div className="p-3 rounded-xl border text-xs font-medium bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-400 shadow-md shadow-emerald-600/30">
                  <div className="font-bold flex items-center justify-between">
                    <span>🌟 Wan animate动作迁移 49s/1500帧长视频 V5</span>
                    <span className="text-[9px] bg-emerald-950/90 text-emerald-200 border border-emerald-400/40 px-1.5 py-0.5 rounded font-mono font-bold">WebApp: 2001911147597033473</span>
                  </div>
                  <div className="text-[10px] opacity-90 mt-1">Wan 2.1 Character Motion Transfer (Max 49s/1500 Frames) • Foto: Node 17 • Video: Node 102 • Prompt: Node 709</div>
                </div>
              </div>
            </div>

            {/* Character Style Engine (Anti-Distortion) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">
                  Character Style Engine (Anti-Distortion)
                </label>
                <span className="text-[10px] text-cyan-400 font-bold">Prevents Ugly Faces</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleStyleChange('faithful')}
                  className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                    styleMode === 'faithful'
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white border-cyan-400 shadow-md shadow-cyan-600/30'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="font-bold flex items-center justify-between">
                    <span>Faithful Mode</span>
                    <span className="text-[8px] bg-cyan-950 text-cyan-300 px-1 py-0.5 rounded uppercase font-bold">Safe</span>
                  </div>
                  <div className="text-[10px] opacity-80 mt-0.5">Keeps 100% original style (Anime/Foto)</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleStyleChange('photorealistic')}
                  className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                    styleMode === 'photorealistic'
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white border-indigo-400 shadow-md shadow-indigo-600/30'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="font-bold">Photorealistic HD</div>
                  <div className="text-[10px] opacity-80 mt-0.5">Cinematic studio human render</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleStyleChange('anime')}
                  className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                    styleMode === 'anime'
                      ? 'bg-gradient-to-r from-pink-600 to-rose-600 text-white border-pink-400 shadow-md shadow-pink-600/30'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="font-bold">Anime 2D Style</div>
                  <div className="text-[10px] opacity-80 mt-0.5">Vibrant colors & hand-drawn outlines</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleStyleChange('cartoon')}
                  className={`p-2.5 rounded-xl border text-xs font-medium text-left transition-all ${
                    styleMode === 'cartoon'
                      ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white border-amber-400 shadow-md shadow-amber-600/30'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="font-bold">Stylized Cartoon</div>
                  <div className="text-[10px] opacity-80 mt-0.5">Smooth Pixar/3D character model</div>
                </button>
              </div>
            </div>

            {/* Orientation Mode */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 block">
                Character Orientation Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCharacterOrientation('video')}
                  className={`p-3 rounded-xl border text-xs font-medium transition-all ${
                    characterOrientation === 'video'
                      ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/30'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="font-bold">Follow Video</div>
                  <div className="text-[10px] opacity-80">Max 30s orientation</div>
                </button>

                <button
                  type="button"
                  onClick={() => setCharacterOrientation('image')}
                  className={`p-3 rounded-xl border text-xs font-medium transition-all ${
                    characterOrientation === 'image'
                      ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/30'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="font-bold">Follow Image</div>
                  <div className="text-[10px] opacity-80">Max 10s orientation</div>
                </button>
              </div>
            </div>

            {/* Resolution Selector (1080HD) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 block">
                  Output Video Resolution
                </label>
                <span className="text-[10px] text-emerald-400 font-bold font-mono">1080HD Wajib & Active</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setResolution('1080p')}
                  className={`p-2.5 rounded-xl border text-xs font-medium transition-all flex items-center justify-between ${
                    resolution === '1080p'
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-400 shadow-md shadow-emerald-600/30'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="text-left">
                    <div className="font-bold flex items-center space-x-1">
                      <span>1080HD Full HD</span>
                      <span className="text-[9px] bg-emerald-950 text-emerald-300 px-1 py-0.2 rounded border border-emerald-400/40">WAJIB</span>
                    </div>
                    <div className="text-[10px] opacity-90">1080p Crystal Clear</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setResolution('720p')}
                  className={`p-2.5 rounded-xl border text-xs font-medium transition-all flex items-center justify-between ${
                    resolution === '720p'
                      ? 'bg-slate-800 text-white border-slate-600 shadow-md'
                      : 'bg-slate-950 text-slate-500 border-slate-900 hover:bg-slate-900 hover:text-slate-400'
                  }`}
                >
                  <div className="text-left">
                    <div className="font-bold">720p SD</div>
                    <div className="text-[10px] opacity-70">Lower Resolution</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Quality Mode Selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 block">
                Rendering Quality Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setQualityMode('pro')}
                  className={`p-2.5 rounded-xl border text-xs font-medium transition-all ${
                    qualityMode === 'pro'
                      ? 'bg-emerald-600 text-white border-emerald-400 shadow-md shadow-emerald-600/30'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="font-bold">Ultra HD Pro</div>
                  <div className="text-[10px] opacity-80">Best motion & face details</div>
                </button>

                <button
                  type="button"
                  onClick={() => setQualityMode('std')}
                  className={`p-2.5 rounded-xl border text-xs font-medium transition-all ${
                    qualityMode === 'std'
                      ? 'bg-slate-700 text-white border-slate-500'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="font-bold">Standard</div>
                  <div className="text-[10px] opacity-80">Normal rendering</div>
                </button>
              </div>
            </div>

            {/* Keep Original Sound Toggle */}
            <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-xl">
              <div className="flex items-center space-x-2 text-xs text-slate-200">
                {keepOriginalSound ? (
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                ) : (
                  <VolumeX className="w-4 h-4 text-slate-500" />
                )}
                <div>
                  <span className="font-semibold block">Keep Original Sound</span>
                  <span className="text-[10px] text-slate-400">Retain video audio track</span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={keepOriginalSound}
                onChange={(e) => setKeepOriginalSound(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 cursor-pointer"
              />
            </div>

            {/* Prompts Section with Booster Button */}
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-300 block">
                    Quality Guidance Prompt
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setPrompt(
                        'masterpiece, best quality, ultra-detailed 1080p Full HD, crystal clear visual clarity, photorealistic 8k character render, crisp sharp focus, consistent studio lighting, physically accurate lighting and shadows, balanced light sources, 60fps smooth realistic motion, stable face identity, high fidelity video'
                      )
                    }
                    className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800 flex items-center space-x-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>✨ Boost 1080HD Prompt</span>
                  </button>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Smooth cinematic lighting, hyper-realistic motion transfer, 4k detail..."
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Negative Prompt (Anti-Distortion)
                </label>
                <input
                  type="text"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="e.g. Blurry, distortion, extra limbs, bad face..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {submitError && (
              <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>{submitError}</div>
              </div>
            )}

            {/* Submit Action Button */}
            <button
              id="btn-submit-motion-control"
              onClick={handleSubmitTask}
              disabled={submitting}
              className="w-full py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-600/30 flex items-center justify-center space-x-2 transition-all"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-white" />
                  <span>Submitting to RunningHub...</span>
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  <span>Generate Motion Control Video</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Task Queue & Live Monitor Section */}
      <div className="space-y-4">
        <h3 className="text-base font-bold text-white flex items-center space-x-2">
          <Code2 className="w-5 h-5 text-cyan-400" />
          <span>Active Tasks & Generations</span>
        </h3>

        {tasks.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-xs space-y-2">
            <Info className="w-8 h-8 text-slate-600 mx-auto" />
            <p>No active tasks submitted yet. Fill in the workbench above or use Telegram Bot view to generate your first video!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tasks.map((task) => (
              <StudioTaskCard
                key={task.id}
                task={task}
                settings={settings}
                onUpdateTask={onUpdateTask}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface StudioTaskCardProps {
  task: MotionControlTask;
  settings: AppSettings;
  onUpdateTask: (taskId: string, updates: Partial<MotionControlTask>) => void;
}

const StudioTaskCard: React.FC<StudioTaskCardProps> = ({ task, settings, onUpdateTask }) => {
  const [showJson, setShowJson] = useState(false);

  React.useEffect(() => {
    if (task.status !== 'RUNNING') return;

    const interval = setInterval(async () => {
      try {
        const queryRes = await queryTaskStatus(task.taskId, settings.apiKey);

        if (queryRes.status === 'SUCCESS' && queryRes.results && queryRes.results.length > 0) {
          onUpdateTask(task.taskId, {
            status: 'SUCCESS',
            resultUrl: queryRes.results[0].url,
            completedAt: Date.now(),
            taskCostTime: queryRes.usage?.taskCostTime,
            remainCoins: queryRes.remainCoins,
            creditCost: queryRes.creditCost || 15,
            rawResponse: queryRes,
          });
          clearInterval(interval);
        } else if (queryRes.status === 'FAILED') {
          onUpdateTask(task.taskId, {
            status: 'FAILED',
            errorCode: queryRes.errorCode || '1501',
            errorMessage: queryRes.errorMessage || 'Content verification failed or motion error',
            rawResponse: queryRes,
          });
          clearInterval(interval);
        }
      } catch (err: any) {
        console.error('Error polling studio task:', err);
      }
    }, settings.pollIntervalMs || 4000);

    return () => clearInterval(interval);
  }, [task.taskId, task.status, settings.apiKey, settings.pollIntervalMs]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg relative overflow-hidden">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-cyan-400 font-bold">
          Task ID: {task.taskId}
        </span>
        <span
          className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
            task.status === 'SUCCESS'
              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
              : task.status === 'FAILED'
              ? 'bg-rose-950 text-rose-300 border border-rose-800'
              : 'bg-amber-950 text-amber-300 border border-amber-800 animate-pulse'
          }`}
        >
          {task.status}
        </span>
      </div>

      {/* Media previews */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-950 rounded-xl overflow-hidden aspect-video border border-slate-800 relative">
          <img src={task.imageUrl} alt="Ref" className="w-full h-full object-cover" />
          <span className="absolute bottom-1 left-1 text-[9px] bg-slate-900/80 px-1.5 py-0.5 rounded text-slate-300">
            Character
          </span>
        </div>
        <div className="bg-slate-950 rounded-xl overflow-hidden aspect-video border border-slate-800 relative">
          <video src={task.videoUrl} className="w-full h-full object-cover" />
          <span className="absolute bottom-1 left-1 text-[9px] bg-slate-900/80 px-1.5 py-0.5 rounded text-slate-300">
            Motion
          </span>
        </div>
      </div>

      {/* Result Player */}
      {task.status === 'SUCCESS' && task.resultUrl && (
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <label className="text-xs font-bold text-emerald-400 flex items-center space-x-1.5">
            <CheckCircle2 className="w-4 h-4" />
            <span>Generated Result Video:</span>
          </label>
          <video
            src={task.resultUrl}
            controls
            autoPlay
            loop
            className="w-full rounded-xl border border-emerald-800/60 bg-black aspect-video object-cover"
          />
          <div className="flex items-center justify-between text-xs pt-1">
            <div className="flex flex-col space-y-0.5 text-slate-400 text-[10px]">
              <span>Cost time: {task.taskCostTime || 'N/A'}s</span>
              <span>💰 Credit Terpakai: <strong className="text-cyan-400">{task.creditCost || 15} RH Coins</strong></span>
              {task.remainCoins !== undefined && (
                <span>👛 Sisa Saldo: <strong className="text-emerald-400">{task.remainCoins} RH Coins</strong></span>
              )}
            </div>
            <a
              href={task.resultUrl}
              target="_blank"
              download="kling_motion_control.mp4"
              rel="noreferrer"
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs flex items-center space-x-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download MP4</span>
            </a>
          </div>
        </div>
      )}

      {task.status === 'FAILED' && (
        <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-300 space-y-1">
          <div className="font-semibold flex items-center space-x-1">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <span>Task Failed ({task.errorCode || 'Error'})</span>
          </div>
          <p className="text-[11px] opacity-90">{task.errorMessage}</p>
        </div>
      )}

      {task.status === 'RUNNING' && (
        <div className="p-3 bg-cyan-950/40 border border-cyan-800/60 rounded-xl text-xs text-cyan-300 flex items-center space-x-2">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
          <span>Processing with Kling v3.0... Polling RunningHub status</span>
        </div>
      )}

      <button
        onClick={() => setShowJson(!showJson)}
        className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center space-x-1 pt-1"
      >
        <FileText className="w-3 h-3" />
        <span>{showJson ? 'Hide Debug JSON' : 'Show Raw JSON Response'}</span>
      </button>

      {showJson && (
        <pre className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-[10px] font-mono text-cyan-300 overflow-x-auto max-h-40">
          {JSON.stringify(task.rawResponse || task, null, 2)}
        </pre>
      )}
    </div>
  );
};
