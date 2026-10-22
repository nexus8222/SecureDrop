import React, { useState, useEffect } from 'react';
import {
  Clipboard,
  Plus,
  Trash2,
  Copy,
  Clock,
  Radio,
  Share2,
} from 'lucide-react';
import { api } from '../api';
import { ClipboardItem } from '../types';

export const ClipboardTerminal: React.FC = () => {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [newText, setNewText] = useState('');
  const [expiresSeconds, setExpiresSeconds] = useState(3600);
  const [showAddModal, setShowAddModal] = useState(false);

  // Load from local or API
  const fetchLocalItems = () => {
    try {
      const stored = localStorage.getItem('sd_clipboard_cache');
      if (stored) setItems(JSON.parse(stored));
    } catch {}
  };

  useEffect(() => {
    fetchLocalItems();
  }, []);

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    try {
      const res = await api.pushClipboard(newText.trim(), undefined, undefined);
      const newItem: ClipboardItem = {
        id: res.id,
        text: newText.trim(),
        created_at: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + expiresSeconds,
      };
      const updated = [newItem, ...items];
      setItems(updated);
      localStorage.setItem('sd_clipboard_cache', JSON.stringify(updated));
      setNewText('');
      setShowAddModal(false);
    } catch (err: any) {
      alert(`Save note failed: ${err.message}`);
    }
  };

  const handleDeleteNote = (id: string) => {
    api.deleteClipboardItem(id).catch(() => {});
    const updated = items.filter((i) => i.id !== id);
    setItems(updated);
    localStorage.setItem('sd_clipboard_cache', JSON.stringify(updated));
  };

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg">Secure Ephemeral Notepad</h2>
            <p className="text-xs text-surface-500">
              Encrypted text snippets and one-time credentials with automated scrubbing.
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            <Plus size={14} /> New Snippet
          </button>
        </div>

        {items.length === 0 ? (
          <div className="py-12 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-xl text-center space-y-2">
            <Clipboard size={28} className="mx-auto text-surface-400" />
            <p className="text-sm font-medium">Notepad is Empty</p>
            <p className="text-xs text-surface-500">
              Create an ephemeral text note to share or keep temporarily in your session.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 flex flex-col justify-between gap-3"
              >
                <div className="p-3 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 text-xs font-mono max-h-40 overflow-y-auto whitespace-pre-wrap select-all">
                  {item.text}
                </div>

                <div className="flex items-center justify-between text-xs text-surface-500 pt-2 border-t border-surface-200 dark:border-surface-800">
                  <span className="text-[10px] font-mono">
                    {new Date(item.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => navigator.clipboard.writeText(item.text)}
                      className="p-1.5 rounded-lg border border-surface-300 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-800 text-surface-600 dark:text-surface-400"
                      title="Copy to clipboard"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      onClick={() => handleDeleteNote(item.id)}
                      className="p-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400"
                      title="Delete snippet"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Snippet Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form
            onSubmit={handleSaveNote}
            className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl"
          >
            <h3 className="font-bold text-base">Store Ephemeral Snippet</h3>

            <div>
              <textarea
                required
                rows={5}
                placeholder="Paste code, private tokens, or notes..."
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                className="w-full p-3 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Auto-Expire After
              </label>
              <select
                value={expiresSeconds}
                onChange={(e) => setExpiresSeconds(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
              >
                <option value={600}>10 Minutes</option>
                <option value={3600}>1 Hour</option>
                <option value={86400}>24 Hours</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 rounded-lg border border-surface-300 dark:border-surface-700 text-xs font-medium hover:bg-surface-100 dark:hover:bg-surface-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm"
              >
                Save Snippet
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
