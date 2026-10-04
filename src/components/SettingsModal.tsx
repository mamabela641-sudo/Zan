import React from 'react';
import { Sliders, X, RefreshCw, Volume2, Video, Sparkles } from 'lucide-react';
import { AppSettings, OrientationMode } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl text-slate-100 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-6">
          <div className="p-3 bg-indigo-950 text-indigo-400 border border-indigo-800 rounded-xl">
            <Sliders className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Motion Control Preferences</h3>
            <p className="text-xs text-slate-400">Configure default API and bot execution behavior</p>
          </div>
        </div>

        <div className="space-y-5">
          {/* Default Model Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Default Motion Control Model
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onUpdateSettings({ defaultModel: 'motion-v2' })}
                className={`p-3 rounded-xl border text-xs font-medium text-left transition-all ${
                  (settings.defaultModel || 'motion-v2') === 'motion-v2'
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-blue-400 shadow-md shadow-blue-600/30'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="font-bold flex items-center justify-between">
                  <span>Motion V2</span>
                  <span className="text-[9px] bg-blue-950 text-blue-300 px-1.5 py-0.5 rounded font-mono">1080HD</span>
                </div>
                <div className="text-[10px] opacity-80 mt-0.5">Motion V2 1080p HD</div>
              </button>

              <button
                type="button"
                onClick={() => onUpdateSettings({ defaultModel: 'wan-2.1' })}
                className={`p-3 rounded-xl border text-xs font-medium text-left transition-all ${
                  settings.defaultModel === 'wan-2.1'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-400 shadow-md shadow-emerald-600/30'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="font-bold flex items-center justify-between">
                  <span>Wan 2.1</span>
                  <span className="text-[9px] bg-emerald-950 text-emerald-300 px-1.5 py-0.5 rounded">V5</span>
                </div>
                <div className="text-[10px] opacity-80 mt-0.5">Wan 2.1 Motion Control</div>
              </button>
            </div>
          </div>

          {/* Default Orientation */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Character Orientation Mode
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onUpdateSettings({ defaultOrientation: 'video' })}
                className={`p-3 rounded-xl border text-xs font-medium flex items-center space-x-2 transition-all ${
                  settings.defaultOrientation === 'video'
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/30'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Video className="w-4 h-4" />
                <div className="text-left">
                  <div className="font-semibold">Follow Video</div>
                  <div className="text-[10px] opacity-80">Max 30 seconds</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onUpdateSettings({ defaultOrientation: 'image' })}
                className={`p-3 rounded-xl border text-xs font-medium flex items-center space-x-2 transition-all ${
                  settings.defaultOrientation === 'image'
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/30'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Sparkles className="w-4 h-4" />
                <div className="text-left">
                  <div className="font-semibold">Follow Image</div>
                  <div className="text-[10px] opacity-80">Max 10 seconds</div>
                </div>
              </button>
            </div>
          </div>

          {/* Audio setting */}
          <div className="flex items-center justify-between p-3.5 bg-slate-950 border border-slate-800/80 rounded-xl">
            <div className="flex items-center space-x-3">
              <Volume2 className="w-5 h-5 text-indigo-400" />
              <div>
                <span className="text-xs font-semibold text-white block">Keep Original Video Sound</span>
                <span className="text-[11px] text-slate-400">Retain original audio track in output video</span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.defaultKeepOriginalSound}
              onChange={(e) => onUpdateSettings({ defaultKeepOriginalSound: e.target.checked })}
              className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
            />
          </div>

          {/* Polling Interval */}
          <div className="p-3.5 bg-slate-950 border border-slate-800/80 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center space-x-2">
                <RefreshCw className="w-4 h-4 text-cyan-400" />
                <span>Task Status Poll Interval</span>
              </span>
              <span className="text-xs font-mono text-cyan-300 font-bold">
                {settings.pollIntervalMs / 1000}s
              </span>
            </div>
            <input
              type="range"
              min="2000"
              max="10000"
              step="1000"
              value={settings.pollIntervalMs}
              onChange={(e) => onUpdateSettings({ pollIntervalMs: Number(e.target.value) })}
              className="w-full accent-cyan-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>Fast (2s)</span>
              <span>Standard (4s)</span>
              <span>Slow (10s)</span>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
