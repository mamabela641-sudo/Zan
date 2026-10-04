import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  ShieldCheck,
  UserX,
  UserCheck,
  Clock,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Crown,
  Film,
} from 'lucide-react';
import { TelegramBotUser } from '../types';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({ isOpen, onClose }) => {
  const [users, setUsers] = useState<TelegramBotUser[]>([]);
  const [adminUserIds, setAdminUserIds] = useState<number[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    pending: 0,
    blocked: 0,
    admins: 0,
    totalGenerated: 0,
  });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'blocked' | 'admins'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setAdminUserIds(data.adminUserIds || []);
        if (data.stats) setStats(data.stats);
      }
    } catch (e) {
      console.error('Failed to fetch users:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleApprove = async (userId: number) => {
    setActionLoadingId(userId);
    try {
      const res = await fetch(`/api/users/${userId}/approve`, { method: 'POST' });
      if (res.ok) {
        await fetchUsers();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (userId: number) => {
    setActionLoadingId(userId);
    try {
      const res = await fetch(`/api/users/${userId}/reject`, { method: 'POST' });
      if (res.ok) {
        await fetchUsers();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleToggleAdmin = async (userId: number, currentRole: 'admin' | 'user') => {
    setActionLoadingId(userId);
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      const res = await fetch(`/api/users/${userId}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        await fetchUsers();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoadingId(null);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesFilter =
      filter === 'all'
        ? true
        : filter === 'pending'
        ? u.status === 'pending'
        : filter === 'active'
        ? u.status === 'active'
        : filter === 'blocked'
        ? u.status === 'blocked'
        : filter === 'admins'
        ? u.role === 'admin' || adminUserIds.includes(u.id)
        : true;

    const term = searchTerm.toLowerCase();
    const fullName = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
    const username = (u.username || '').toLowerCase();
    const idStr = String(u.id);

    const matchesSearch =
      !searchTerm || fullName.includes(term) || username.includes(term) || idStr.includes(term);

    return matchesFilter && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
                <span>Kelola Akses Pengguna Telegram</span>
                {stats.pending > 0 && (
                  <span className="px-2 py-0.5 text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full animate-pulse">
                    {stats.pending} Menunggu Izin
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Persetujuan multi-tier dan kontrol otorisasi generator bot
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-4 bg-slate-950/30 border-b border-slate-800 text-xs">
          <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl flex items-center space-x-2.5">
            <Users className="w-4 h-4 text-slate-400 shrink-0" />
            <div>
              <div className="text-slate-400 text-[10px]">Total User</div>
              <div className="text-sm font-bold text-white">{stats.total}</div>
            </div>
          </div>

          <div className="bg-amber-950/30 border border-amber-800/40 p-2.5 rounded-xl flex items-center space-x-2.5">
            <Clock className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <div className="text-amber-300 text-[10px]">Menunggu Izin</div>
              <div className="text-sm font-bold text-amber-200">{stats.pending}</div>
            </div>
          </div>

          <div className="bg-emerald-950/30 border border-emerald-800/40 p-2.5 rounded-xl flex items-center space-x-2.5">
            <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <div className="text-emerald-300 text-[10px]">User Aktif</div>
              <div className="text-sm font-bold text-emerald-200">{stats.active}</div>
            </div>
          </div>

          <div className="bg-rose-950/30 border border-rose-800/40 p-2.5 rounded-xl flex items-center space-x-2.5">
            <UserX className="w-4 h-4 text-rose-400 shrink-0" />
            <div>
              <div className="text-rose-300 text-[10px]">Diblokir</div>
              <div className="text-sm font-bold text-rose-200">{stats.blocked}</div>
            </div>
          </div>

          <div className="bg-cyan-950/30 border border-cyan-800/40 p-2.5 rounded-xl flex items-center space-x-2.5 col-span-2 sm:col-span-1">
            <Film className="w-4 h-4 text-cyan-400 shrink-0" />
            <div>
              <div className="text-cyan-300 text-[10px]">Total Video</div>
              <div className="text-sm font-bold text-cyan-200">{stats.totalGenerated}</div>
            </div>
          </div>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="p-3 sm:p-4 border-b border-slate-800 flex flex-col sm:flex-row gap-2.5 sm:items-center justify-between">
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0">
            {(['all', 'pending', 'active', 'blocked', 'admins'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize whitespace-nowrap transition-colors ${
                  filter === f
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {f === 'all'
                  ? 'Semua'
                  : f === 'pending'
                  ? `Pending (${stats.pending})`
                  : f === 'active'
                  ? `Aktif (${stats.active})`
                  : f === 'blocked'
                  ? `Blokir (${stats.blocked})`
                  : `Admin (${stats.admins})`}
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-2">
            <div className="relative flex-1 sm:w-60">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari nama, @username, ID..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={fetchUsers}
              disabled={loading}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* User Table / List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {filteredUsers.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs sm:text-sm">
              <Users className="w-8 h-8 mx-auto mb-2 text-slate-600" />
              Tidak ada pengguna yang cocok dengan kriteria pencarian / filter.
            </div>
          ) : (
            filteredUsers.map((u) => {
              const isAdmin = u.role === 'admin' || adminUserIds.includes(u.id);
              const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'User';

              return (
                <div
                  key={u.id}
                  className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition-all"
                >
                  <div className="flex items-start space-x-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold text-xs ${
                        isAdmin
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : u.status === 'active'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : u.status === 'pending'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      {isAdmin ? <Crown className="w-4 h-4" /> : fullName[0]?.toUpperCase() || 'U'}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-sm text-white">{fullName}</span>
                        {u.username && (
                          <span className="text-xs text-blue-400 font-mono">@{u.username}</span>
                        )}
                        {isAdmin && (
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded">
                            👑 Admin
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                        <span>
                          ID: <code className="text-slate-300 font-mono">{u.id}</code>
                        </span>
                        <span>•</span>
                        <span>
                          Status:{' '}
                          <strong
                            className={
                              u.status === 'active'
                                ? 'text-emerald-400'
                                : u.status === 'pending'
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }
                          >
                            {u.status === 'active'
                              ? '🟢 Aktif'
                              : u.status === 'pending'
                              ? '⏳ Pending'
                              : '🔴 Diblokir'}
                          </strong>
                        </span>
                        <span>•</span>
                        <span>
                          Generate: <strong className="text-cyan-300">{u.generatedCount || 0}x</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2 self-end sm:self-auto">
                    {u.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(u.id)}
                          disabled={actionLoadingId === u.id}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1 transition-colors shadow-sm"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Izinkan</span>
                        </button>
                        <button
                          onClick={() => handleReject(u.id)}
                          disabled={actionLoadingId === u.id}
                          className="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-lg text-xs font-semibold flex items-center space-x-1 transition-colors"
                        >
                          <UserX className="w-3.5 h-3.5" />
                          <span>Tolak</span>
                        </button>
                      </>
                    )}

                    {u.status === 'active' && !isAdmin && (
                      <button
                        onClick={() => handleReject(u.id)}
                        disabled={actionLoadingId === u.id}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 hover:border-rose-800 border border-slate-700 rounded-lg text-xs transition-colors"
                      >
                        Blokir Akses
                      </button>
                    )}

                    {u.status === 'blocked' && (
                      <button
                        onClick={() => handleApprove(u.id)}
                        disabled={actionLoadingId === u.id}
                        className="px-3 py-1.5 bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900 rounded-lg text-xs font-semibold transition-colors"
                      >
                        Buka Blokir
                      </button>
                    )}

                    <button
                      onClick={() => handleToggleAdmin(u.id, u.role)}
                      disabled={actionLoadingId === u.id}
                      className={`p-1.5 rounded-lg border text-xs transition-colors ${
                        isAdmin
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                      }`}
                      title={isAdmin ? 'Cabut Role Admin' : 'Jadikan Admin'}
                    >
                      <Crown className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between text-xs text-slate-400">
          <div>
            Semua perubahan status langsung disinkronkan secara real-time ke bot Telegram.
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
