import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, X, ShieldCheck, User } from 'lucide-react';
import { api } from '../api';
import { ChatMessage } from '../types';

interface TargetParticipant {
  id: string;
  name: string;
  username?: string;
  isPeer?: boolean;
}

interface OneToOneChatModalProps {
  target: TargetParticipant;
  myId: string;
  myName: string;
  onClose: () => void;
}

export const OneToOneChatModal: React.FC<OneToOneChatModalProps> = ({
  target,
  myId,
  myName,
  onClose,
}) => {
  // Deterministic 1-to-1 direct channel
  const channel = `dm_${[myId, target.id].sort().join('_')}`;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const fetchHistory = async () => {
    try {
      const res = await api.getChat(channel);
      setMessages(res.messages || []);
    } catch {}
  };

  useEffect(() => {
    fetchHistory();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'chat_message' && data.message?.channel === channel) {
            setMessages((prev) => [...prev, data.message]);
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (ws) ws.close();
    };
  }, [channel]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || sending) return;

    const textToSend = inputText.trim();
    setInputText('');
    setSending(true);

    try {
      await api.sendChat(channel, textToSend, myName);
    } catch (err: any) {
      alert(`Message failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl w-full max-w-lg flex flex-col shadow-2xl h-[520px] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between bg-surface-50/50 dark:bg-surface-950/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold text-sm">
              <User size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-surface-900 dark:text-surface-100">
                  {target.name}
                </h3>
                <span className="w-2 h-2 rounded-full bg-emerald-500" title="Online" />
              </div>
              <p className="text-[11px] text-surface-500 font-mono flex items-center gap-1">
                <ShieldCheck size={11} className="text-emerald-500" />
                1-to-1 Direct LAN Channel
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Message Stream */}
        <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto space-y-3 bg-surface-50/30 dark:bg-surface-950/20">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-surface-400 p-6 space-y-2">
              <MessageSquare size={32} className="opacity-40" />
              <p className="text-sm font-medium">Direct Ephemeral Chat</p>
              <p className="text-xs max-w-xs text-surface-500">
                Messages between you and {target.name} are exchanged in real-time over the local network.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const isMine = m.sender_id === myId || m.sender_name === myName;
              return (
                <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[10px] font-semibold text-surface-500">{m.sender_name}</span>
                    <span className="text-[9px] text-surface-400 font-mono">
                      {new Date(m.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div
                    className={`px-3.5 py-2 rounded-2xl text-xs max-w-[80%] break-words ${
                      isMine
                        ? 'bg-emerald-600 text-white rounded-tr-none'
                        : 'bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-surface-800 dark:text-surface-200 rounded-tl-none'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Input */}
        <form onSubmit={handleSend} className="p-3 border-t border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Message ${target.name}...`}
            className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
            autoFocus
          />
          <button
            type="submit"
            disabled={!inputText.trim() || sending}
            className="p-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white transition-colors"
          >
            <Send size={15} />
          </button>
        </form>
      </div>
    </div>
  );
};
