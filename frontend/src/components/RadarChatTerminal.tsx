import React, { useState, useEffect, useRef } from 'react';
import {
  Radio,
  Send,
  MessageSquare,
  Shield,
  ShieldCheck,
  Clipboard,
  Key,
  Eye,
  EyeOff,
  RefreshCw,
  Clock,
  User,
  Check,
} from 'lucide-react';
import { api } from '../api';
import { PeerDevice, ChatMessage, AuthStatus } from '../types';
import { OneToOneChatModal } from './OneToOneChatModal';

interface RadarChatProps {
  auth: AuthStatus | null;
}

export const RadarChatTerminal: React.FC<RadarChatProps> = ({ auth }) => {
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [visibility, setVisibility] = useState<'everyone' | 'contacts' | 'hidden'>('everyone');

  // Clipboard Push State
  const [pushTargetDevice, setPushTargetDevice] = useState<PeerDevice | null>(null);
  const [pushText, setPushText] = useState('');

  // SAS Pairing Handshake State
  const [pairingDevice, setPairingDevice] = useState<PeerDevice | null>(null);
  const [pairingPin, setPairingPin] = useState<string | null>(null);
  const [pairingRequestId, setPairingRequestId] = useState<string | null>(null);
  const [verifyPinInput, setVerifyPinInput] = useState('');

  // Ephemeral Chat State
  const [chatChannel, setChatChannel] = useState('general');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [directChatTarget, setDirectChatTarget] = useState<{ id: string; name: string; username?: string } | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const fetchPeers = async () => {
    setLoading(true);
    try {
      const res = await api.listPeers();
      setPeers(res.peers || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const fetchChat = async (channel: string) => {
    try {
      const res = await api.getChat(channel);
      setMessages(res.messages || []);
    } catch {}
  };

  useEffect(() => {
    fetchPeers();
    fetchChat(chatChannel);

    api.getVisibility().then((res) => {
      if (res && res.visibility) setVisibility(res.visibility);
    }).catch(() => {});
  }, [chatChannel]);

  // WebSocket for real-time peer radar & chat updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'peer_seen') {
            fetchPeers();
          } else if (data.type === 'chat_message' && data.message?.channel === chatChannel) {
            setMessages((prev) => [...prev, data.message]);
          } else if (data.type === 'pairing_requested') {
            // Display pairing alert
            setPairingPin(data.pin);
            setPairingRequestId(data.request_id);
          } else if (data.type === 'clipboard_pushed') {
            // Target received clipboard item
            alert(`Clipboard received from ${data.from}: "${data.text.slice(0, 50)}..."`);
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (ws) ws.close();
    };
  }, [chatChannel]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleProbe = async () => {
    setProbing(true);
    try {
      await api.probePeers();
      setTimeout(fetchPeers, 1000);
    } catch {}
    finally {
      setProbing(false);
    }
  };

  const handleVisibilityChange = async (vis: 'everyone' | 'contacts' | 'hidden') => {
    setVisibility(vis);
    await api.setVisibility(vis);
  };

  const handlePushClipboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pushTargetDevice || !pushText.trim()) return;
    try {
      await api.pushClipboard(pushText.trim(), pushTargetDevice.device_id);
      alert(`Clipboard successfully pushed directly to "${pushTargetDevice.name}"!`);
      setPushTargetDevice(null);
      setPushText('');
    } catch (err: any) {
      alert(`Clipboard push failed: ${err.message}`);
    }
  };

  const handleStartPairing = async (target: PeerDevice) => {
    setPairingDevice(target);
    try {
      const res = await api.pairRequest(target.device_id);
      setPairingRequestId(res.request_id);
      setPairingPin(res.pin);
    } catch (err: any) {
      alert(`Pairing request failed: ${err.message}`);
    }
  };

  const handleVerifyPairing = async () => {
    if (!pairingRequestId || !verifyPinInput.trim()) return;
    try {
      await api.pairVerify(pairingRequestId, verifyPinInput.trim());
      alert('SAS PIN Handshake verified successfully! Device is now trusted.');
      setPairingDevice(null);
      setPairingPin(null);
      setPairingRequestId(null);
      setVerifyPinInput('');
      fetchPeers();
    } catch (err: any) {
      alert(`Verification failed: ${err.message}`);
    }
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const txt = chatInput.trim();
    setChatInput('');
    const sender = auth?.user?.display_name || auth?.user?.username || 'LAN Peer';
    try {
      await api.sendChat(chatChannel, txt, sender);
    } catch {}
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left 2 Cols: LAN Peer Radar */}
      <div className="lg:col-span-2 space-y-4">
        <div className="p-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Radio size={18} className="text-emerald-500 animate-pulse" />
                LAN Peer Radar
              </h2>
              <p className="text-xs text-surface-500">
                Zero-config UDP multicast & broadcast mesh radar. Open across all nodes.
              </p>
            </div>

            {/* Visibility Toggle & Probe */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-surface-100 dark:bg-surface-800 rounded-lg text-xs font-mono">
                <button
                  onClick={() => handleVisibilityChange('everyone')}
                  className={`px-2 py-1 rounded ${
                    visibility === 'everyone'
                      ? 'bg-white dark:bg-surface-900 shadow-sm text-surface-900 dark:text-surface-100'
                      : 'text-surface-500 hover:text-surface-900'
                  }`}
                  title="Visible to all LAN peers"
                >
                  Everyone
                </button>
                <button
                  onClick={() => handleVisibilityChange('contacts')}
                  className={`px-2 py-1 rounded ${
                    visibility === 'contacts'
                      ? 'bg-white dark:bg-surface-900 shadow-sm text-surface-900 dark:text-surface-100'
                      : 'text-surface-500 hover:text-surface-900'
                  }`}
                  title="Visible only to paired contacts"
                >
                  Contacts
                </button>
                <button
                  onClick={() => handleVisibilityChange('hidden')}
                  className={`px-2 py-1 rounded ${
                    visibility === 'hidden'
                      ? 'bg-white dark:bg-surface-900 shadow-sm text-surface-900 dark:text-surface-100'
                      : 'text-surface-500 hover:text-surface-900'
                  }`}
                  title="Hidden from discovery radar"
                >
                  Hidden
                </button>
              </div>

              <button
                onClick={handleProbe}
                disabled={probing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 text-xs font-medium hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                title="Send active UDP multicast probe"
              >
                <RefreshCw size={13} className={probing ? 'animate-spin' : ''} /> Probe Mesh
              </button>
            </div>
          </div>

          {/* Active Peers Grid */}
          {loading ? (
            <div className="py-12 text-center text-xs text-surface-500 font-mono">
              Listening for LAN heartbeats on 239.255.45.67:45678...
            </div>
          ) : peers.length === 0 ? (
            <div className="py-12 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-xl text-center space-y-2">
              <Radio size={28} className="mx-auto text-surface-400" />
              <p className="text-sm font-semibold">No Other Peers Detected</p>
              <p className="text-xs text-surface-500">
                Ensure devices are connected to the same subnet or Wi-Fi network. Multicast packets auto-broadcast every 7s.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {peers.map((peer) => (
                <div
                  key={peer.device_id}
                  className="p-5 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      <div>
                        <h3 className="font-bold text-sm text-surface-900 dark:text-surface-100 truncate max-w-[170px]">
                          {peer.name}
                        </h3>
                        <span className="text-[10px] text-surface-500 font-mono block">
                          ID: {peer.device_id}
                        </span>
                      </div>
                    </div>

                    {peer.trusted ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <ShieldCheck size={11} /> Paired
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-200 dark:bg-surface-800 text-surface-600 dark:text-surface-400">
                        Untrusted
                      </span>
                    )}
                  </div>

                  {/* Network IPs */}
                  <div className="p-2 rounded bg-white/60 dark:bg-surface-900/60 border border-surface-200 dark:border-surface-800/60 text-xs font-mono space-y-1">
                    <div className="flex justify-between text-surface-500">
                      <span>LAN IP:</span>
                      <span className="text-surface-900 dark:text-surface-100">
                        {peer.ips?.[0] || 'Unknown'}
                      </span>
                    </div>
                    <div className="flex justify-between text-surface-500">
                      <span>Web Port:</span>
                      <span className="text-surface-900 dark:text-surface-100">:{peer.web_port}</span>
                    </div>
                  </div>

                  {/* Actions: Directional Clipboard Push & SAS Pairing & 1-to-1 Chat */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-surface-200 dark:border-surface-800/80">
                    <button
                      onClick={() => setDirectChatTarget({ id: peer.device_id, name: peer.name })}
                      className="flex-1 min-w-[90px] py-1.5 rounded-lg border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                      title="Open 1-to-1 direct chat with this peer"
                    >
                      <MessageSquare size={12} /> Direct Chat
                    </button>

                    <button
                      onClick={() => setPushTargetDevice(peer)}
                      className="flex-1 min-w-[90px] py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-800 text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                      title="Directly push text to this peer's clipboard"
                    >
                      <Clipboard size={12} /> Push Text
                    </button>

                    {!peer.trusted && (
                      <button
                        onClick={() => handleStartPairing(peer)}
                        className="flex-1 min-w-[90px] py-1.5 rounded-lg bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900 hover:opacity-90 text-xs font-medium flex items-center justify-center gap-1 transition-opacity"
                        title="Establish cryptographic SAS pairing handshake"
                      >
                        <Key size={12} /> Pair Device
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Col: Ephemeral LAN Chat Drawer */}
      <div className="space-y-4">
        <div className="p-5 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 flex flex-col h-[520px]">
          <div className="flex items-center justify-between pb-3 border-b border-surface-200 dark:border-surface-800">
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-emerald-500" />
              <h3 className="font-bold text-sm">Ephemeral LAN Chat</h3>
            </div>
            <select
              value={chatChannel}
              onChange={(e) => setChatChannel(e.target.value)}
              className="px-2 py-1 text-xs rounded border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 font-mono"
            >
              <option value="general"># general</option>
              <option value="transfers"># transfers</option>
              <option value="devops"># devops</option>
            </select>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto py-3 space-y-3">
            {messages.length === 0 ? (
              <div className="py-12 text-center text-xs text-surface-400 font-mono">
                No chat messages in #{chatChannel} yet.
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className="p-2.5 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 space-y-1"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {m.sender_name}
                    </span>
                    <span className="text-surface-400 text-[10px]">
                      {new Date(m.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-surface-800 dark:text-surface-200 break-words">{m.text}</p>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Send Chat Form */}
          <form onSubmit={handleSendChatMessage} className="pt-3 border-t border-surface-200 dark:border-surface-800 flex gap-2">
            <input
              type="text"
              placeholder={`Message #${chatChannel}...`}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>

      {/* Modal: Directional Clipboard Push */}
      {pushTargetDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form
            onSubmit={handlePushClipboard}
            className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl"
          >
            <h3 className="font-bold text-base">Direct Clipboard Push</h3>
            <p className="text-xs text-surface-500">
              Transmit text directly into "{pushTargetDevice.name}" clipboard stream.
            </p>

            <textarea
              required
              rows={4}
              placeholder="Enter text or token to push..."
              value={pushText}
              onChange={(e) => setPushText(e.target.value)}
              className="w-full p-2.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 font-mono focus:outline-none focus:border-emerald-500"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPushTargetDevice(null)}
                className="flex-1 py-2 rounded-lg border border-surface-300 dark:border-surface-700 text-xs font-medium hover:bg-surface-100 dark:hover:bg-surface-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm"
              >
                Push Text
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: One-to-One Direct Chat */}
      {directChatTarget && (
        <OneToOneChatModal
          target={directChatTarget}
          myId={auth?.user?.id || 'gst_local'}
          myName={auth?.user?.display_name || auth?.user?.username || 'Local Peer'}
          onClose={() => setDirectChatTarget(null)}
        />
      )}

      {/* Modal: SAS Pairing Handshake */}
      {pairingDevice && pairingPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
            <h3 className="font-bold text-base">SAS Cryptographic Pairing</h3>
            <p className="text-xs text-surface-500">
              Confirm this 4-digit Short Authentication String (SAS) code matches on "{pairingDevice.name}":
            </p>

            <div className="py-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-3xl font-extrabold tracking-widest text-emerald-600 dark:text-emerald-400 font-mono">
              {pairingPin}
            </div>

            <div className="space-y-2 text-left">
              <label className="text-xs font-medium text-surface-600 dark:text-surface-400">
                Confirm Receiver SAS PIN
              </label>
              <input
                type="text"
                maxLength={4}
                placeholder="4-digit PIN"
                value={verifyPinInput}
                onChange={(e) => setVerifyPinInput(e.target.value)}
                className="w-full px-3 py-1.5 text-center text-sm font-bold font-mono tracking-widest rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPairingDevice(null)}
                className="flex-1 py-2 rounded-lg border border-surface-300 dark:border-surface-700 text-xs font-medium hover:bg-surface-100 dark:hover:bg-surface-800"
              >
                Cancel
              </button>
              <button
                onClick={handleVerifyPairing}
                className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm"
              >
                Verify & Trust
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
