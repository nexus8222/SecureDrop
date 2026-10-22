import React, { useState, useEffect } from 'react';
import {
  FolderSync,
  Trash2,
  QrCode,
  Download,
  Copy,
  ExternalLink,
  RefreshCw,
  HardDrive,
  Clock,
  Eye,
  X,
} from 'lucide-react';
import { api } from '../api';
import { ShareItem, AuthStatus } from '../types';

interface HostedSharesProps {
  auth: AuthStatus | null;
}

export const HostedSharesTerminal: React.FC<HostedSharesProps> = ({ auth }) => {
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQrToken, setSelectedQrToken] = useState<string | null>(null);

  const fetchShares = async () => {
    setLoading(true);
    try {
      // Gather any tokens stored locally for guests
      const userScope = auth?.user?.id || 'guest';
      const localTokensRaw = localStorage.getItem(`sd_tokens_${userScope}`);
      const localTokens = localTokensRaw ? JSON.parse(localTokensRaw) : [];

      const res = await api.listMyShares(localTokens);
      setShares(res.shares || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShares();
  }, [auth]);

  const handleDeleteShare = async (token: string) => {
    if (!confirm('Are you sure you want to revoke this share and immediately scrub its chunks from disk?')) {
      return;
    }
    try {
      await api.deleteShare(token);
      setShares((prev) => prev.filter((s) => s.token !== token));
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatTime = (ts: number) => {
    return new Date(ts * 1000).toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg">Hosted Shares Directory</h2>
            <p className="text-xs text-surface-500">
              Active payloads currently hosted on your node storage. Revoking immediately scrubs physical chunks.
            </p>
          </div>
          <button
            onClick={fetchShares}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 text-xs font-medium hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-surface-500 font-mono">
            Loading hosted shares...
          </div>
        ) : shares.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-center border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-xl">
            <FolderSync size={32} className="text-surface-400" />
            <div className="space-y-1">
              <p className="font-semibold text-sm">No Active Shares</p>
              <p className="text-xs text-surface-500">
                You haven't dispatched any active file payloads yet.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {shares.map((share) => (
              <div
                key={share.token}
                className="p-5 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-sm text-surface-900 dark:text-surface-100 truncate">
                      {share.title || 'Untitled Share'}
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                        share.status === 'open'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {share.status}
                    </span>
                  </div>

                  <div className="space-y-1 text-xs font-mono text-surface-600 dark:text-surface-400">
                    <div className="flex justify-between">
                      <span className="text-surface-400">Access PIN:</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">{share.pin}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-400">Payload Size:</span>
                      <span>{formatBytes(share.total_size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-400">Downloads:</span>
                      <span>
                        {share.downloads} {share.max_downloads ? `/ ${share.max_downloads}` : ''}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-400">Created:</span>
                      <span className="text-[11px]">{formatTime(share.created_at)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-surface-200 dark:border-surface-800/80">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setSelectedQrToken(share.token)}
                      className="p-1.5 rounded-lg border border-surface-300 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-800 text-surface-600 dark:text-surface-400"
                      title="Show QR Code"
                    >
                      <QrCode size={14} />
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/share/${share.token}`)}
                      className="p-1.5 rounded-lg border border-surface-300 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-800 text-surface-600 dark:text-surface-400"
                      title="Copy Share Link"
                    >
                      <Copy size={14} />
                    </button>
                    <a
                      href={`/share/${share.token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg border border-surface-300 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-800 text-surface-600 dark:text-surface-400"
                      title="Open in Viewer"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </div>

                  {share.can_delete && (
                    <button
                      onClick={() => handleDeleteShare(share.token)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium transition-colors"
                      title="Revoke & Scrub"
                    >
                      <Trash2 size={13} /> Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* QR Code Lightbox Modal */}
      {selectedQrToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl relative">
            <button
              onClick={() => setSelectedQrToken(null)}
              className="absolute top-4 right-4 text-surface-400 hover:text-surface-900 dark:hover:text-surface-100"
            >
              <X size={18} />
            </button>

            <div className="text-center space-y-1">
              <h3 className="font-bold text-base">Quick Mobile QR Code</h3>
              <p className="text-xs text-surface-500">Scan with any phone camera on the LAN to download</p>
            </div>

            <div className="p-4 bg-white rounded-xl border border-surface-200 flex items-center justify-center">
              <img
                src={`/api/shares/${selectedQrToken}/qr`}
                alt="Share QR"
                className="w-48 h-48 object-contain"
              />
            </div>

            <div className="flex justify-center">
              <button
                onClick={() => setSelectedQrToken(null)}
                className="w-full py-2 rounded-lg bg-surface-100 dark:bg-surface-800 text-xs font-medium hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
