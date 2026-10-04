import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { TelegramBotView } from './components/TelegramBotView';
import { StudioView } from './components/StudioView';
import { ApiInspectorView } from './components/ApiInspectorView';
import { ApiKeyModal } from './components/ApiKeyModal';
import { SettingsModal } from './components/SettingsModal';
import { PresetPickerModal } from './components/PresetPickerModal';
import { UserManagementModal } from './components/UserManagementModal';
import { AppSettings, MotionControlTask, SamplePreset } from './types';
import {
  getStoredSettings,
  saveSettings,
  getStoredTasks,
  saveTasks,
  checkServerHealth,
  fetchPresets,
} from './lib/api';

export default function App() {
  const [activeTab, setActiveTab] = useState<'bot' | 'studio' | 'api-docs'>('bot');
  const [settings, setSettings] = useState<AppSettings>(getStoredSettings());
  const [tasks, setTasks] = useState<MotionControlTask[]>(getStoredTasks());
  const [samplePresets, setSamplePresets] = useState<SamplePreset[]>([]);
  const [hasServerKey, setHasServerKey] = useState<boolean>(false);

  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState<boolean>(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState<boolean>(false);

  // Load server health & presets on mount
  useEffect(() => {
    checkServerHealth().then((health) => {
      setHasServerKey(health.hasDefaultApiKey);
    });

    fetchPresets().then((presets) => {
      setSamplePresets(presets);
    });
  }, []);

  // Save tasks to localStorage whenever tasks state updates
  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  const handleSaveApiKey = (newKey: string) => {
    const updated = saveSettings({ apiKey: newKey });
    setSettings(updated);
  };

  const handleUpdateSettings = (newSettings: Partial<AppSettings>) => {
    const updated = saveSettings(newSettings);
    setSettings(updated);
  };

  const handleAddTask = (newTask: MotionControlTask) => {
    setTasks((prev) => [newTask, ...prev]);
  };

  const handleUpdateTask = (taskId: string, updates: Partial<MotionControlTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.taskId === taskId ? { ...t, ...updates, updatedAt: Date.now() } : t))
    );
  };

  const handleSelectPreset = (preset: SamplePreset) => {
    // Switch to studio mode if selected preset from modal
    setActiveTab('studio');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-white flex flex-col">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        settings={settings}
        onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        onOpenUsersModal={() => setIsUserModalOpen(true)}
        hasServerKey={hasServerKey}
      />

      <main className="flex-1">
        {activeTab === 'bot' && (
          <TelegramBotView
            settings={settings}
            onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
            onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
            hasServerKey={hasServerKey}
            samplePresets={samplePresets}
            tasks={tasks}
            onAddTask={handleAddTask}
            onUpdateTask={handleUpdateTask}
          />
        )}

        {activeTab === 'studio' && (
          <StudioView
            settings={settings}
            onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
            onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
            hasServerKey={hasServerKey}
            samplePresets={samplePresets}
            tasks={tasks}
            onAddTask={handleAddTask}
            onUpdateTask={handleUpdateTask}
            onOpenPresetModal={() => setIsPresetModalOpen(true)}
          />
        )}

        {activeTab === 'api-docs' && (
          <ApiInspectorView settings={settings} hasServerKey={hasServerKey} />
        )}
      </main>

      {/* Modals */}
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        apiKey={settings.apiKey}
        onSaveKey={handleSaveApiKey}
        hasServerKey={hasServerKey}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />

      <PresetPickerModal
        isOpen={isPresetModalOpen}
        onClose={() => setIsPresetModalOpen(false)}
        samplePresets={samplePresets}
        onSelectPreset={handleSelectPreset}
      />

      <UserManagementModal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
      />
    </div>
  );
}
