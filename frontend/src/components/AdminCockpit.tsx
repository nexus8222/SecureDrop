import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  HardDrive,
  Users,
  DownloadCloud,
  History,
  X,
  ChevronLeft,
  ChevronRight,
  Trash2,
  UserCheck,
  UserX,
  RefreshCw,
  Search,
} from 'lucide-react';
import { api } from '../api';

export const AdminCockpit: React.FC = () => {
  const [overview, setOverview] = useState<any>(null);
  const [activeModal, setActiveModal] = useState<'storage' | 'rbac' | 'pulls' | 'audit' | null>(null);

  // Pagination state for active modal
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [modalData, setModalData] = useState<any[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchOverview = async () => {
    try {
      const res = await api.adminGetStorageOverview();
      setOverview(res);
    } catch {}
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  // Fetch paginated modal data whenever activeModal, page, or limit changes
  useEffect(() => {
    if (!activeModal) return;
    loadModalData();
  }, [activeModal, page, limit]);

  const loadModalData = async () => {
    setModalLoading(true);
    try {
      if (activeModal === 'storage') {
        const res = await api.adminGetStorageAudit(page, limit);
        setModalData(res.shares || []);
        setTotalRows(res.total || 0);
        setTotalPages(res.pages || 1);
      } else if (activeModal === 'rbac') {
        const res = await api.adminGetUsers(page, limit, searchQuery);
        setModalData(res.users || []);
        setTotalRows(res.total || 0);
        setTotalPages(res.pages || 1);
      } else if (activeModal === 'pulls') {
        const res = await api.adminGetNodePulls(page, limit);
        setModalData(res.jobs || []);
        setTotalRows(res.total || 0);
        setTotalPages(res.pages || 1);
      } else if (activeModal === 'audit') {
        const res = await api.adminGetAuditLogs(page, limit);
        setModalData(res.history || []);
        setTotalRows(res.total || 0);
        setTotalPages(res.pages || 1);
      }
    } catch {
      // ignore
    } finally {
      setModalLoading(false);
    }
  };

  const openModal = (type: 'storage' | 'rbac' | 'pulls' | 'audit') => {
    setActiveModal(type);
    setPage(1);
    setSearchQuery('');
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      {/* Admin Telemetry Cards */}
      <div className="p-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 space-y-6">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2">
            <ShieldCheck size={20} className="text-blue-500" />
            Admin Telemetry & Systems Governance
          </h2>
          <p className="text-xs text-surface-500">
            Intranet air-gapped node telemetry. Modals enforce paginated 25 / 100 / 200 data boundaries without DB overload.
          </p>
        </div>

        {/* 4 Management Gateway Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            onClick={() => openModal('storage')}
            className="p-5 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 hover:border-blue-500 text-left transition-all space-y-2 group"
          >
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center group-hover:scale-105 transition-transform">
              <HardDrive size={18} />
            </div>
            <h3 className="font-bold text-sm">Storage & Shares Audit</h3>
            <p className="text-xs text-surface-500">
              Audit stored chunks, physical quotas, and orphaned assets.
            </p>
            <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold block pt-1">Open Modal →</span>
          </button>

          <button
            onClick={() => openModal('rbac')}
            className="p-5 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 hover:border-emerald-500 text-left transition-all space-y-2 group"
          >
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center group-hover:scale-105 transition-transform">
              <Users size={18} />
            </div>
            <h3 className="font-bold text-sm">User RBAC Management</h3>
            <p className="text-xs text-surface-500">
              Manage member accounts, permissions, and active sessions.
            </p>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold block pt-1">Open Modal →</span>
          </button>

          <button
            onClick={() => openModal('pulls')}
            className="p-5 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 hover:border-amber-500 text-left transition-all space-y-2 group"
          >
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center group-hover:scale-105 transition-transform">
              <DownloadCloud size={18} />
            </div>
            <h3 className="font-bold text-sm">Background Node Pulls</h3>
            <p className="text-xs text-surface-500">
              High-bandwidth TCP transfer jobs across distributed nodes.
            </p>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-semibold block pt-1">Open Modal →</span>
          </button>

          <button
            onClick={() => openModal('audit')}
            className="p-5 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 hover:border-purple-500 text-left transition-all space-y-2 group"
          >
            <div className="w-9 h-9 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center group-hover:scale-105 transition-transform">
              <History size={18} />
            </div>
            <h3 className="font-bold text-sm">System Audit Logs</h3>
            <p className="text-xs text-surface-500">
              Immutable event log of network transfers and node lifecycles.
            </p>
            <span className="text-xs text-purple-600 dark:text-purple-400 font-semibold block pt-1">Open Modal →</span>
          </button>
        </div>

        {/* Global Overview Stats */}
        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-surface-200 dark:border-surface-800 text-xs font-mono">
            <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-950">
              <span className="text-surface-400 block">Total Stored Size</span>
              <span className="text-base font-bold text-surface-900 dark:text-surface-100">
                {formatBytes(overview.total_stored_size_bytes)}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-950">
              <span className="text-surface-400 block">Total Chunks</span>
              <span className="text-base font-bold text-surface-900 dark:text-surface-100">
                {overview.total_chunks}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-950">
              <span className="text-surface-400 block">Open Shares</span>
              <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                {overview.open_shares}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-950">
              <span className="text-surface-400 block">Expired / Scrubbed</span>
              <span className="text-base font-bold text-surface-500">
                {overview.expired_shares}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Paginated Management Modal */}
      {activeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base capitalize">
                  {activeModal === 'storage' && 'Server Storage & Shares Audit'}
                  {activeModal === 'rbac' && 'User RBAC Governance'}
                  {activeModal === 'pulls' && 'Background Node Pull Jobs'}
                  {activeModal === 'audit' && 'Security Audit Log Trail'}
                </h3>
                <span className="text-xs text-surface-500 font-mono">
                  Showing {modalData.length} of {totalRows} records (Page {page} of {totalPages})
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Rows per page selector: 25 / 100 / 200 */}
                <div className="flex items-center gap-1.5 text-xs text-surface-500 font-mono">
                  <span>Rows:</span>
                  <select
                    value={limit}
                    onChange={(e) => {
                      setLimit(Number(e.target.value));
                      setPage(1);
                    }}
                    className="px-2 py-1 rounded border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950"
                  >
                    <option value={25}>25</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>

                <button
                  onClick={() => setActiveModal(null)}
                  className="p-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-400 hover:text-surface-900 dark:hover:text-surface-100"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body Table */}
            <div className="flex-1 overflow-y-auto p-5">
              {modalLoading ? (
                <div className="py-12 text-center text-xs text-surface-500 font-mono animate-pulse">
                  Querying paginated slice from SQLite WAL engine...
                </div>
              ) : modalData.length === 0 ? (
                <div className="py-12 text-center text-xs text-surface-500">
                  No records found in this partition.
                </div>
              ) : (
                <div className="border border-surface-200 dark:border-surface-800 rounded-lg overflow-hidden">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 font-mono">
                      {activeModal === 'storage' && (
                        <tr>
                          <th className="p-3">Token</th>
                          <th className="p-3">Title</th>
                          <th className="p-3">PIN</th>
                          <th className="p-3">Stored Size</th>
                          <th className="p-3">Status</th>
                          <th className="p-3 text-right">Audit</th>
                        </tr>
                      )}
                      {activeModal === 'rbac' && (
                        <tr>
                          <th className="p-3">Username</th>
                          <th className="p-3">Display Name</th>
                          <th className="p-3">Role</th>
                          <th className="p-3">Status</th>
                          <th className="p-3 text-right">Actions</th>
                        </tr>
                      )}
                      {activeModal === 'pulls' && (
                        <tr>
                          <th className="p-3">Job ID</th>
                          <th className="p-3">Title</th>
                          <th className="p-3">Progress</th>
                          <th className="p-3">Status</th>
                        </tr>
                      )}
                      {activeModal === 'audit' && (
                        <tr>
                          <th className="p-3">Time</th>
                          <th className="p-3">Direction</th>
                          <th className="p-3">Target / Peer</th>
                          <th className="p-3">Details</th>
                        </tr>
                      )}
                    </thead>

                    <tbody className="divide-y divide-surface-200 dark:divide-surface-800 font-mono">
                      {activeModal === 'storage' &&
                        modalData.map((s) => (
                          <tr key={s.token} className="hover:bg-surface-50 dark:hover:bg-surface-800/40">
                            <td className="p-3 font-bold text-surface-900 dark:text-surface-100">{s.token}</td>
                            <td className="p-3 truncate max-w-[150px]">{s.title || 'Untitled'}</td>
                            <td className="p-3 text-emerald-600 dark:text-emerald-400">{s.pin}</td>
                            <td className="p-3">{formatBytes(s.stored_size)}</td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded text-[10px] bg-surface-200 dark:bg-surface-800">
                                {s.status}
                              </span>
                            </td>
                            <td className="p-3 text-right text-surface-400 text-[10px]">[Audit Only]</td>
                          </tr>
                        ))}

                      {activeModal === 'rbac' &&
                        modalData.map((u) => (
                          <tr key={u.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/40">
                            <td className="p-3 font-bold">{u.username}</td>
                            <td className="p-3">{u.display_name}</td>
                            <td className="p-3 font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                              {u.role}
                            </td>
                            <td className="p-3">{u.status}</td>
                            <td className="p-3 text-right">
                              {u.username !== 'admin' && (
                                <button
                                  onClick={async () => {
                                    if (confirm(`Delete user ${u.username}?`)) {
                                      await api.adminDeleteUser(u.id);
                                      loadModalData();
                                    }
                                  }}
                                  className="text-rose-500 hover:underline"
                                >
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}

                      {activeModal === 'pulls' &&
                        modalData.map((j) => (
                          <tr key={j.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/40">
                            <td className="p-3 font-bold">{j.id}</td>
                            <td className="p-3 truncate max-w-[150px]">{j.title}</td>
                            <td className="p-3">{Math.round(j.progress * 100)}%</td>
                            <td className="p-3">{j.status}</td>
                          </tr>
                        ))}

                      {activeModal === 'audit' &&
                        modalData.map((h) => (
                          <tr key={h.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/40">
                            <td className="p-3 text-[11px]">
                              {new Date(h.created_at * 1000).toLocaleTimeString()}
                            </td>
                            <td className="p-3 uppercase text-[10px] font-bold">{h.direction}</td>
                            <td className="p-3">{h.peer || 'local'}</td>
                            <td className="p-3 text-surface-500 truncate max-w-[200px]">{h.detail}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Pagination Footer */}
            <div className="p-4 border-t border-surface-200 dark:border-surface-800 flex items-center justify-between text-xs font-mono">
              <span className="text-surface-500">
                Page {page} of {totalPages} ({totalRows} total rows)
              </span>

              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1 || modalLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 disabled:opacity-40 hover:bg-surface-100 dark:hover:bg-surface-800 flex items-center gap-1"
                >
                  <ChevronLeft size={13} /> Prev
                </button>
                <button
                  disabled={page >= totalPages || modalLoading}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 disabled:opacity-40 hover:bg-surface-100 dark:hover:bg-surface-800 flex items-center gap-1"
                >
                  Next <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
