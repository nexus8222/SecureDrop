import React, { useState, useEffect } from 'react';
import {
  Key,
  Download,
  FileText,
  Shield,
  Eye,
  CheckCircle,
  AlertCircle,
  FileArchive,
  Play,
} from 'lucide-react';
import { api } from '../api';
import { ShareItem } from '../types';

export const ReceiveTerminal: React.FC = () => {
  const [pin, setPin] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareData, setShareData] = useState<ShareItem | null>(null);
  const [manifest, setManifest] = useState<any | null>(null);

  // Keypad inputs
  const handleKeypadPress = (digit: string) => {
    if (pin.length < 4) {
      setPin((prev) => prev + digit);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin('');
  };

  // Auto-fetch share once 4 digits entered
  useEffect(() => {
    if (pin.length === 4) {
      fetchShareByPin(pin);
    }
  }, [pin]);

  const fetchShareByPin = async (lookupPin: string) => {
    setLoading(true);
    setError(null);
    try {
      const share = await api.getShareByPin(lookupPin);
      setShareData(share);

      // Pre-flight manifest inspect
      try {
        const man = await api.getManifest(share.token);
        if (man && man.manifest) setManifest(man.manifest);
      } catch {}
    } catch (err: any) {
      setError(err.message || 'Share not found with this PIN');
      setShareData(null);
      setManifest(null);
    } finally {
      setLoading(false);
    }
  };

  const handleTokenLookup = async () => {
    if (!tokenInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const share = await api.getShareMeta(tokenInput.trim());
      setShareData(share);
      try {
        const man = await api.getManifest(share.token);
        if (man && man.manifest) setManifest(man.manifest);
      } catch {}
    } catch (err: any) {
      setError(err.message || 'Share not found');
      setShareData(null);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="p-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 space-y-6">
        <div>
          <h2 className="font-bold text-lg">Receive LAN Payload</h2>
          <p className="text-xs text-surface-500">Enter a 4-digit PIN code or direct share token.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* Keypad */}
          <div className="flex flex-col items-center gap-4">
            <div className="w-full max-w-xs flex flex-col items-center gap-3">
              <span className="text-xs uppercase font-mono tracking-widest text-surface-500">
                Enter 4-Digit PIN
              </span>

              {/* PIN Display */}
              <div className="flex gap-3">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className={`w-14 h-16 rounded-xl border-2 flex items-center justify-center text-2xl font-bold font-mono transition-all ${
                      pin[idx]
                        ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 text-surface-400'
                    }`}
                  >
                    {pin[idx] || '·'}
                  </div>
                ))}
              </div>

              {/* Numeric Keypad Grid */}
              <div className="grid grid-cols-3 gap-2 w-full mt-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      if (k === 'C') handleClear();
                      else if (k === '⌫') handleBackspace();
                      else handleKeypadPress(k);
                    }}
                    className="h-12 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 hover:bg-surface-100 dark:hover:bg-surface-800 font-bold text-lg transition-colors flex items-center justify-center"
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Token Lookup & Quick Actions */}
          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 space-y-3">
              <span className="text-xs font-semibold text-surface-700 dark:text-surface-300">
                Or Lookup by Share Token
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. 10-char token"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 font-mono focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={handleTokenLookup}
                  className="px-4 py-1.5 rounded-lg bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900 text-xs font-medium hover:opacity-90"
                >
                  Inspect
                </button>
              </div>
            </div>

            {loading && (
              <div className="p-4 rounded-xl border border-surface-200 dark:border-surface-800 text-center text-xs text-surface-500 font-mono animate-pulse">
                Resolving manifest from local storage node...
              </div>
            )}

            {error && (
              <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* Resolved Share Inspection & Download */}
            {shareData && (
              <div className="p-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileArchive size={20} className="text-emerald-500" />
                    <div>
                      <h3 className="font-bold text-sm text-emerald-950 dark:text-emerald-100">
                        {shareData.title}
                      </h3>
                      <p className="text-[11px] text-surface-500 font-mono">Token: {shareData.token}</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    Active
                  </span>
                </div>

                {/* Pre-flight Manifest Inspector */}
                {manifest && (
                  <div className="space-y-2 pt-2 border-t border-emerald-500/20">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-surface-700 dark:text-surface-300">
                        Pre-flight Manifest ({manifest.total_files} files, {formatBytes(manifest.total_size)})
                      </span>
                    </div>

                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {manifest.files?.map((f: any, idx: number) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded bg-white/60 dark:bg-surface-900/60 text-xs font-mono"
                        >
                          <span className="truncate max-w-[180px]">{f.name}</span>
                          <span className="text-surface-500">{formatBytes(f.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Download Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <a
                    href={`/api/shares/${shareData.token}/zip`}
                    className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-colors"
                  >
                    <Download size={14} /> Download ZIP Archive
                  </a>

                  <a
                    href={`/share/${shareData.token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-700 text-xs font-medium hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors flex items-center gap-1.5"
                  >
                    <Eye size={13} /> Full Viewer
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
