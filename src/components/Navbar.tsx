import React from 'react';
import { Bot, Key, Sliders, Terminal, Sparkles, Video, CheckCircle2, AlertCircle, Users } from 'lucide-react';
import { AppSettings } from '../types';

interface NavbarProps {
  activeTab: 'bot' | 'studio' | 'api-docs';
  setActiveTab: (tab: 'bot' | 'studio' | 'api-docs') => void;
  settings: AppSettings;
  onOpenApiKeyModal: () => void;
  onOpenSettingsModal: () => void;
  onOpenUsersModal?: () => void;
  hasServerKey: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  settings,
  onOpenApiKeyModal,
  onOpenSettingsModal,
  onOpenUsersModal,
  hasServerKey,
}) => {
  const hasUserKey = Boolean(settings.apiKey && settings.apiKey.trim().length > 0);
  const isKeyConfigured = hasUserKey || hasServerKey;

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand & Title */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Video className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-cyan-400 bg-clip-text text-transparent">
                RunningHub
              </span>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800/80 rounded-full">
                Kling v3.0 Motion
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">Standard AI Model API & Telegram Bot Studio</p>
          </div>
        </div>

        {/* View Tabs */}
        <nav className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800/80">
          <button
            id="tab-bot"
            onClick={() => setActiveTab('bot')}
            className={`flex items-center space-x-2 px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'bot'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Bot className="w-4 h-4" />
            <span>Bot View</span>
          </button>

          <button
            id="tab-studio"
            onClick={() => setActiveTab('studio')}
            className={`flex items-center space-x-2 px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'studio'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Studio View</span>
          </button>

          <button
            id="tab-api-docs"
            onClick={() => setActiveTab('api-docs')}
            className={`flex items-center space-x-2 px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'api-docs'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span className="hidden sm:inline">API Inspector</span>
            <span className="sm:hidden">API</span>
          </button>
        </nav>

        {/* Status & Settings */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {onOpenUsersModal && (
            <button
              id="btn-users-modal"
              onClick={onOpenUsersModal}
              className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
              title="Kelola Akses Pengguna Telegram"
            >
              <Users className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">User Access</span>
            </button>
          )}

          <button
            id="btn-key-status"
            onClick={onOpenApiKeyModal}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              isKeyConfigured
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800 hover:bg-emerald-900/60'
                : 'bg-amber-950/60 text-amber-300 border-amber-800 hover:bg-amber-900/60 animate-bounce'
            }`}
            title="Configure RunningHub 32-bit API Key"
          >
            <Key className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              {hasUserKey ? 'Custom Key' : hasServerKey ? 'Default Key' : 'No Key Set'}
            </span>
            {isKeyConfigured ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            )}
          </button>

          <button
            id="btn-settings"
            onClick={onOpenSettingsModal}
            className="p-2 text-slate-400 hover:text-white bg-slate-950 hover:bg-slate-800 rounded-lg border border-slate-800 transition-colors"
            title="Application Settings"
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
