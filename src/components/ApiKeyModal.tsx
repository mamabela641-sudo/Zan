import React, { useState, useEffect, useRef } from 'react';
import {
  Key,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  X,
  ExternalLink,
  Zap,
  ListPlus,
  Upload,
  FileText,
} from 'lucide-react';
import {
  ApiKeyPoolItemUI,
  fetchApiKeyPool,
  addKeyToPool,
  bulkImportKeysToPool,
  deleteKeyFromPool,
  verifyAllKeysInPool,
  toggleAutoRotate,
} from '../lib/api';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  onSaveKey: (newKey: string) => void;
  hasServerKey: boolean;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  onSaveKey,
}) => {
  const [keysPool, setKeysPool] = useState<ApiKeyPoolItemUI[]>([]);
  const [autoRotate, setAutoRotateState] = useState(true);
  const [inputMode, setInputMode] = useState<'single' | 'bulk'>('single');
  const [newKeyInput, setNewKeyInput] = useState('');
  const [bulkTextInput, setBulkTextInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [bulkProcessingMsg, setBulkProcessingMsg] = useState<string | null>(null);
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [bulkResultStats, setBulkResultStats] = useState<{
    total: number;
    enterpriseCount: number;
    nonEnterpriseCount: number;
    invalidCount: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadPool();
    }
  }, [isOpen]);

  const loadPool = async () => {
    try {
      setLoading(true);
      const data = await fetchApiKeyPool();
      setKeysPool(data.keys || []);
      setAutoRotateState(data.autoRotate);
    } catch (err: any) {
      console.error('Error loading API Key Pool:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleAddKey = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newKeyInput.trim()) return;

    setErrorMsg(null);
    setSuccessMsg(null);
    setBulkResultStats(null);
    setLoading(true);

    try {
      const res = await addKeyToPool(newKeyInput.trim());
      setKeysPool(res.keys);
      setNewKeyInput('');
      onSaveKey(newKeyInput.trim());

      const addedStatus = res.keyItem.statusLabel;
      setSuccessMsg(`Key berhasil ditambahkan! Status: ${addedStatus}`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menambahkan API Key');
    } finally {
      setLoading(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setBulkTextInput(content);
        setSuccessMsg(`File "${file.name}" berhasil dimuat. Silakan periksa atau klik tombol Proses.`);
      }
    };
    reader.onerror = () => {
      setErrorMsg('Gagal membaca file .txt');
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  const handleBulkImport = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!bulkTextInput.trim()) return;

    const rawLines = bulkTextInput.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l.length >= 8);
    if (rawLines.length === 0) {
      setErrorMsg('Tidak ada API Key yang valid ditemukan. Pastikan minimal 8 karakter per baris.');
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);
    setBulkResultStats(null);
    setLoading(true);
    setBulkProcessingMsg(`⏳ Memeriksa ${rawLines.length} API Key...`);

    try {
      const res = await bulkImportKeysToPool(bulkTextInput);
      setKeysPool(res.keys);
      setBulkResultStats(res.summary);
      setBulkTextInput('');
      setSuccessMsg(`✅ API Key Pool selesai! (Total ${res.summary.total} key)`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memproses Bulk Import API Key');
    } finally {
      setLoading(false);
      setBulkProcessingMsg(null);
    }
  };

  const handleDeleteKey = async (id: string) => {
    try {
      setLoading(true);
      const res = await deleteKeyFromPool(id);
      setKeysPool(res.keys);
      setSuccessMsg('API Key berhasil dihapus dari Pool');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menghapus API Key');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAll = async () => {
    setVerifyingAll(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await verifyAllKeysInPool();
      setKeysPool(res.keys);
      setSuccessMsg('Semua API Key telah diverifikasi!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memverifikasi API Keys');
    } finally {
      setVerifyingAll(false);
    }
  };

  const handleToggleAutoRotate = async () => {
    try {
      const res = await toggleAutoRotate(!autoRotate);
      setAutoRotateState(res.autoRotate);
    } catch (err: any) {
      console.error('Failed to toggle auto rotate:', err);
    }
  };

  const getBadgeStyle = (status: ApiKeyPoolItemUI['status']) => {
    switch (status) {
      case 'enterprise':
        return 'bg-emerald-950/80 border-emerald-700 text-emerald-300';
      case 'non_enterprise':
        return 'bg-rose-950/80 border-rose-800 text-rose-300';
      case 'invalid':
        return 'bg-amber-950/80 border-amber-800 text-amber-300';
      case 'unverified':
      default:
        return 'bg-slate-800 border-slate-700 text-slate-300';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl text-slate-100 relative max-h-[90vh] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-4 shrink-0">
          <div className="p-3 bg-cyan-950 text-cyan-400 border border-cyan-800 rounded-xl">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white flex items-center space-x-2">
              <span>🔑 RUNNINGHUB API KEY POOL</span>
            </h3>
            <p className="text-xs text-slate-400">
              Kelola daftar API Key RunningHub dengan Auto-Rotate & Verifikasi Enterprise-Shared
            </p>
          </div>
        </div>

        {/* Status Legend Banner */}
        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-xs mb-4 shrink-0 space-y-1.5">
          <div className="font-semibold text-slate-300">Status Klasifikasi API Key:</div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex items-center space-x-1.5 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>🟢 Enterprise-Shared — Siap</span>
            </div>
            <div className="flex items-center space-x-1.5 text-rose-400">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              <span>🔴 Bukan Enterprise-Shared</span>
            </div>
            <div className="flex items-center space-x-1.5 text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>🔴 Invalid / Auth Failed</span>
            </div>
            <div className="flex items-center space-x-1.5 text-slate-400">
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span>🟡 Belum diverifikasi</span>
            </div>
          </div>
        </div>

        {/* Auto Rotate Control Card */}
        <div className="bg-gradient-to-r from-slate-950 to-slate-900 border border-slate-800 p-3.5 rounded-xl mb-4 shrink-0 flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm text-slate-200 flex items-center space-x-2">
              <RefreshCw className={`w-4 h-4 ${autoRotate ? 'text-emerald-400 animate-spin' : 'text-slate-500'}`} style={{ animationDuration: '6s' }} />
              <span>Auto Rotate API Key</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                autoRotate ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-400'
              }`}>
                {autoRotate ? 'Aktif' : 'Nonaktif'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Generate → pilih key valid → kirim request → jika ditolak/error → otomatis pindah ke key berikutnya.
            </p>
          </div>
          <button
            onClick={handleToggleAutoRotate}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 ml-3 ${
              autoRotate
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }`}
          >
            {autoRotate ? 'Disable Auto Rotate' : 'Enable Auto Rotate'}
          </button>
        </div>

        {/* Input Mode Toggle */}
        <div className="flex border-b border-slate-800 mb-3 shrink-0">
          <button
            type="button"
            onClick={() => setInputMode('single')}
            className={`px-3.5 py-2 text-xs font-semibold flex items-center space-x-1.5 border-b-2 transition-all ${
              inputMode === 'single'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah 1 Key</span>
          </button>
          <button
            type="button"
            onClick={() => setInputMode('bulk')}
            className={`px-3.5 py-2 text-xs font-semibold flex items-center space-x-1.5 border-b-2 transition-all ${
              inputMode === 'bulk'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ListPlus className="w-3.5 h-3.5" />
            <span>➕ BULK IMPORT API KEY</span>
          </button>
        </div>

        {/* Add Key Form */}
        {inputMode === 'single' ? (
          <form onSubmit={handleAddKey} className="mb-4 shrink-0">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              ➕ Tambah Single API Key
            </label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={newKeyInput}
                onChange={(e) => setNewKeyInput(e.target.value)}
                placeholder="Masukkan 32-bit RunningHub API Key..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
              />
              <button
                type="submit"
                disabled={loading || !newKeyInput.trim()}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 shrink-0 shadow-lg shadow-cyan-900/30"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah</span>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleBulkImport} className="mb-4 shrink-0 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                🔑 Bulk Import RunningHub API Key
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".txt,text/plain"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-400 text-[11px] font-medium rounded-lg flex items-center space-x-1 border border-slate-700 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload File .txt</span>
                </button>
              </div>
            </div>
            <textarea
              rows={4}
              value={bulkTextInput}
              onChange={(e) => setBulkTextInput(e.target.value)}
              placeholder={`key_1\nkey_2\nkey_3\n...`}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
            />
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>1 API Key = 1 baris. Baris komentar (#) diabaikan.</span>
              {bulkTextInput.trim() && (
                <span className="text-cyan-400 font-mono">
                  {bulkTextInput.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l.length >= 8 && !l.startsWith('#')).length} key terdeteksi
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={loading || !bulkTextInput.trim()}
              className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 shadow-lg shadow-cyan-900/30"
            >
              <ListPlus className="w-4 h-4" />
              <span>Proses Bulk Import</span>
            </button>
          </form>
        )}

        {/* Bulk Processing Progress Banner */}
        {bulkProcessingMsg && (
          <div className="mb-3 p-3 bg-cyan-950/60 border border-cyan-800 rounded-xl text-xs text-cyan-300 flex items-center space-x-2 shrink-0 animate-pulse">
            <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
            <span>{bulkProcessingMsg}</span>
          </div>
        )}

        {/* Bulk Result Stats Banner */}
        {bulkResultStats && (
          <div className="mb-3 p-3 bg-slate-950 border border-emerald-800/80 rounded-xl text-xs space-y-1.5 shrink-0">
            <div className="font-bold text-emerald-400 flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>✅ API Key Pool Selesai</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-slate-300 text-[11px] pt-1">
              <div>🟢 Enterprise-Shared: <strong className="text-emerald-400">{bulkResultStats.enterpriseCount}</strong></div>
              <div>🔴 Non-Enterprise: <strong className="text-rose-400">{bulkResultStats.nonEnterpriseCount}</strong></div>
              <div>🔴 Invalid: <strong className="text-amber-400">{bulkResultStats.invalidCount}</strong></div>
              <div>Total: <strong className="text-white">{bulkResultStats.total} key</strong></div>
            </div>
          </div>
        )}

        {/* Alert Messages */}
        {errorMsg && (
          <div className="mb-3 p-2.5 bg-rose-950/60 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center space-x-2 shrink-0">
            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-3 p-2.5 bg-emerald-950/60 border border-emerald-800 rounded-xl text-xs text-emerald-300 flex items-center space-x-2 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Keys List Table */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-2 mb-4 min-h-[120px] max-h-[240px]">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 px-1 mb-1">
            <span>📋 DAFTAR API KEY ({keysPool.length})</span>
            <button
              type="button"
              onClick={handleVerifyAll}
              disabled={verifyingAll || keysPool.length === 0}
              className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline flex items-center space-x-1 font-normal disabled:opacity-50"
            >
              <Zap className="w-3 h-3" />
              <span>{verifyingAll ? 'Memverifikasi...' : '⚡ Verifikasi Semua Key'}</span>
            </button>
          </div>

          {keysPool.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 bg-slate-950/50 rounded-xl border border-slate-800/80">
              Belum ada API Key di pool. Tambahkan key pertama Anda di atas.
            </div>
          ) : (
            keysPool.map((item, idx) => (
              <div
                key={item.id}
                className="bg-slate-950 border border-slate-800/80 hover:border-slate-700 p-3 rounded-xl flex items-center justify-between transition-all"
              >
                <div className="space-y-1 min-w-0 pr-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-bold text-white bg-slate-800 px-1.5 py-0.5 rounded">
                      #{idx + 1}
                    </span>
                    <span className="text-xs font-mono text-cyan-300 font-semibold tracking-wider">
                      {item.maskedKey || item.key}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-md border font-semibold ${getBadgeStyle(item.status)}`}>
                      {item.statusLabel}
                    </span>
                    {item.lastError && (
                      <span className="text-[10px] text-rose-400/90 truncate max-w-[200px]" title={item.lastError}>
                        • {item.lastError}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteKey(item.id)}
                  className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors shrink-0"
                  title="Hapus Key ini"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800 shrink-0">
          <a
            href="https://www.runninghub.ai"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-slate-400 hover:text-cyan-400 flex items-center space-x-1"
          >
            <span>Dapatkan Key di RunningHub.ai</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
};
