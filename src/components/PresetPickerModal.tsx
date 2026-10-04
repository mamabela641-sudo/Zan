import React from 'react';
import { X, Sparkles, Video, Play, Check } from 'lucide-react';
import { SamplePreset, OrientationMode } from '../types';

interface PresetPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  samplePresets: SamplePreset[];
  onSelectPreset: (preset: SamplePreset) => void;
}

export const PresetPickerModal: React.FC<PresetPickerModalProps> = ({
  isOpen,
  onClose,
  samplePresets,
  onSelectPreset,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl text-slate-100 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-6">
          <div className="p-3 bg-cyan-950 text-cyan-400 border border-cyan-800 rounded-xl">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Motion Control Sample Presets</h3>
            <p className="text-xs text-slate-400">Select a pre-matched character photo & motion video to test instantly</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {samplePresets.map((preset) => (
            <div
              key={preset.id}
              className="bg-slate-950 border border-slate-800 hover:border-cyan-500/80 rounded-xl p-3 space-y-3 transition-all flex flex-col justify-between group"
            >
              <div className="space-y-2">
                <div className="relative aspect-video rounded-lg overflow-hidden border border-slate-800 bg-black">
                  <img
                    src={preset.imageUrl}
                    alt={preset.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                  <span className="absolute top-1 left-1 bg-slate-900/90 text-cyan-300 font-mono text-[9px] px-1.5 py-0.5 rounded border border-slate-800">
                    {preset.category}
                  </span>
                </div>

                <div>
                  <h4 className="font-bold text-xs text-white">{preset.title}</h4>
                  <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{preset.description}</p>
                </div>
              </div>

              <button
                onClick={() => {
                  onSelectPreset(preset);
                  onClose();
                }}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-blue-600/20 flex items-center justify-center space-x-1.5 transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Use This Preset</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
