import React, { useState, useEffect } from 'react';
import {
  Inbox,
  Download,
  Users,
  Clock,
  Key,
  ExternalLink,
  RefreshCw,
  FolderSync,
} from 'lucide-react';
import { api } from '../api';
import { DirectShareInboxItem } from '../types';

export const DirectSharesTerminal: React.FC = () => {
  const [shares, setShares] = useState<DirectShareInboxItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInbox = async () => {
    setLoading(true);
    try {
      const res = await api.listDirectInbox();
      setShares(res.shares || []);
    } catch {
      // offline / guest
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInbox();
  }, []);

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg">Direct Shares Inbox</h2>
            <p className="text-xs text-surface-500">
              Payloads dispatched directly to your account or your collaborative groups.
            </p>
          </div>
          <button
            onClick={fetchInbox}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 text-xs font-medium hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-surface-500 font-mono">
            Loading inbox items...
          </div>
        ) : shares.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-center border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-xl">
            <Inbox size={32} className="text-surface-400" />
            <div className="space-y-1">
              <p className="font-semibold text-sm">Inbox is Clear</p>
              <p className="text-xs text-surface-500">
                No active direct transfers assigned to your account or groups right now.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {shares.map((item) => (
              <div
                key={item.direct_share_id}
                className="p-5 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <h3 className="font-bold text-sm text-surface-900 dark:text-surface-100 truncate max-w-[180px]">
                      {item.title}
                    </h3>
                  </div>
                  {item.group_name && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                      <Users size={11} /> {item.group_name}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-surface-600 dark:text-surface-400">
                  <div>
                    <span className="text-[10px] uppercase text-surface-400 block">Sender</span>
                    <span className="font-semibold text-surface-800 dark:text-surface-200">{item.sender_name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-surface-400 block">PIN Code</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">{item.pin}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-surface-200 dark:border-surface-800/60">
                  <span className="text-[10px] text-surface-400 flex items-center gap-1">
                    <Clock size={11} /> {formatTime(item.shared_at)}
                  </span>

                  <div className="flex items-center gap-2">
                    <a
                      href={`/api/shares/${item.token}/zip`}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs flex items-center gap-1 transition-colors"
                    >
                      <Download size={13} /> Download
                    </a>
                    <a
                      href={`/share/${item.token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg border border-surface-300 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-800 text-surface-600 dark:text-surface-400"
                      title="Inspect share"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
