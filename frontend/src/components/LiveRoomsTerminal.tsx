import React, { useState, useEffect } from 'react';
import {
  Layers,
  Plus,
  Lock,
  Download,
  Upload,
  RefreshCw,
  Clock,
  User,
  FolderOpen,
  CheckCircle,
  Trash2,
} from 'lucide-react';
import { api } from '../api';
import { CollabRoom, RoomItem, AuthStatus } from '../types';

interface LiveRoomsProps {
  auth: AuthStatus | null;
}

export const LiveRoomsTerminal: React.FC<LiveRoomsProps> = ({ auth }) => {
  const [rooms, setRooms] = useState<CollabRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<CollabRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [roomPinInput, setRoomPinInput] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New room inputs
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPin, setNewRoomPin] = useState('');

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const res = await api.listRooms();
      setRooms(res.rooms || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  // Listen to WebSocket events for real-time room drops
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'room_created') {
            fetchRooms();
          } else if (data.type === 'room_deleted') {
            fetchRooms();
            setActiveRoom((prev) => (prev && prev.id === data.room_id ? null : prev));
          } else if (data.type === 'room_item_added' && activeRoom && data.room_id === activeRoom.id) {
            // Append newly dropped item immediately
            setActiveRoom((prev) =>
              prev ? { ...prev, items: [data.item, ...(prev.items || [])] } : null
            );
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (ws) ws.close();
    };
  }, [activeRoom]);

  const handleOpenRoom = async (room: CollabRoom) => {
    if (room.has_pin && !roomPinInput) {
      const entered = prompt(`Enter PIN for "${room.name}":`);
      if (!entered) return;
      loadRoomDetails(room.id, entered);
    } else {
      loadRoomDetails(room.id, roomPinInput);
    }
  };

  const loadRoomDetails = async (roomId: string, pin?: string) => {
    try {
      const details = await api.getRoom(roomId, pin);
      setActiveRoom(details);
    } catch (err: any) {
      alert(`Could not enter room: ${err.message}`);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    try {
      const res = await api.createRoom(newRoomName.trim(), newRoomPin.trim() || undefined);
      setShowCreateModal(false);
      setNewRoomName('');
      setNewRoomPin('');
      fetchRooms();
      loadRoomDetails(res.room_id);
    } catch (err: any) {
      alert(`Create room failed: ${err.message}`);
    }
  };

  const handleDeleteRoom = async (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this room? All room payloads will be removed.')) return;
    try {
      await api.deleteRoom(roomId);
      if (activeRoom?.id === roomId) {
        setActiveRoom(null);
      }
      fetchRooms();
    } catch (err: any) {
      alert(`Could not delete room: ${err.message}`);
    }
  };

  const canDeleteRoom = (room: CollabRoom) => {
    return (
      auth?.is_admin ||
      auth?.user?.role === 'admin' ||
      (auth?.user?.id && room.host_user_id === auth?.user?.id)
    );
  };

  const handleDropIntoRoom = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeRoom || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    try {
      // 1. Create fast share
      const shareRes = await api.createShare({
        title: file.name,
        mode: 'files',
        expires_seconds: 86400,
      });

      // 2. Register file & upload chunks
      const CHUNK_SIZE = 4 * 1024 * 1024;
      const chunkCount = Math.ceil(file.size / CHUNK_SIZE) || 1;
      const regRes = await api.registerFile(
        shareRes.token,
        {
          name: file.name,
          relative_path: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
          chunk_size: CHUNK_SIZE,
          chunk_count: chunkCount,
        },
        shareRes.upload_token
      );

      for (let i = 0; i < chunkCount; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);
        const buf = await chunkBlob.arrayBuffer();

        await fetch(`/api/shares/${shareRes.token}/files/${regRes.file_id}/chunks/${i}/plain`, {
          method: 'PUT',
          headers: {
            'x-upload-token': shareRes.upload_token,
            'Content-Type': 'application/octet-stream',
          },
          body: buf,
        });
      }

      // 3. Post share token into room
      const sender = auth?.user?.display_name || auth?.user?.username || 'LAN Peer';
      await api.addRoomItem(activeRoom.id, shareRes.token, sender);
    } catch (err: any) {
      alert(`Upload into room failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Rooms Dashboard Header */}
      <div className="p-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg">Multi-Peer Live Rooms (Drop-Boxes)</h2>
            <p className="text-xs text-surface-500">
              Shared collaborative spaces where multiple LAN peers drop and retrieve files in real time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              <Plus size={14} /> New Room
            </button>
            <button
              onClick={fetchRooms}
              className="p-1.5 rounded-lg border border-surface-300 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-600 dark:text-surface-400"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Active Room View or Rooms Grid */}
        {activeRoom ? (
          <div className="space-y-4 pt-4 border-t border-surface-200 dark:border-surface-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="text-emerald-500" size={20} />
                <h3 className="font-bold text-base">{activeRoom.name}</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-100 dark:bg-surface-800 text-surface-500">
                  {activeRoom.items?.length || 0} payloads
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium cursor-pointer shadow-sm transition-colors">
                  <Upload size={13} /> Drop File to Room
                  <input type="file" onChange={handleDropIntoRoom} className="hidden" />
                </label>
                {canDeleteRoom(activeRoom) && (
                  <button
                    onClick={(e) => handleDeleteRoom(e, activeRoom.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 text-xs font-medium transition-colors"
                    title="Delete this room"
                  >
                    <Trash2 size={13} /> Delete Room
                  </button>
                )}
                <button
                  onClick={() => setActiveRoom(null)}
                  className="px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 text-xs font-medium hover:bg-surface-100 dark:hover:bg-surface-800"
                >
                  Exit Room
                </button>
              </div>
            </div>

            {/* Room Dropped Items Feed */}
            {activeRoom.items && activeRoom.items.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeRoom.items.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 flex items-center justify-between gap-3"
                  >
                    <div className="space-y-1 truncate">
                      <h4 className="font-bold text-xs truncate">{item.title || 'Shared File'}</h4>
                      <div className="flex items-center gap-2 text-[11px] text-surface-500 font-mono">
                        <span className="flex items-center gap-1">
                          <User size={11} /> {item.sender_name}
                        </span>
                        <span>•</span>
                        <span>PIN: {item.share_pin}</span>
                      </div>
                    </div>

                    <a
                      href={`/api/shares/${item.share_token}/zip`}
                      className="px-3 py-1.5 rounded-lg bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900 font-medium text-xs flex items-center gap-1 shadow-sm hover:opacity-90 transition-opacity"
                    >
                      <Download size={13} /> Get
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 border-2 border-dashed border-surface-200 dark:border-surface-800 rounded-xl text-center space-y-2">
                <Layers size={28} className="mx-auto text-surface-400" />
                <p className="text-sm font-medium">Room Drop-Box is Empty</p>
                <p className="text-xs text-surface-500">
                  Drop files to instantly share them with all participants connected to this room.
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Available Rooms Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((room) => (
              <div
                key={room.id}
                onClick={() => handleOpenRoom(room)}
                className="p-5 rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 hover:border-emerald-500 cursor-pointer transition-all space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-surface-900 dark:text-surface-100 truncate">
                    {room.name}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    {room.has_pin && (
                      <span className="p-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20" title="PIN Protected">
                        <Lock size={12} />
                      </span>
                    )}
                    {canDeleteRoom(room) && (
                      <button
                        onClick={(e) => handleDeleteRoom(e, room.id)}
                        className="p-1 rounded text-surface-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        title="Delete Room"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-surface-500 font-mono">
                  <span>{room.item_count || 0} payloads dropped</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Enter →</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form
            onSubmit={handleCreateRoom}
            className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl"
          >
            <h3 className="font-bold text-base">Host New Collaborative Room</h3>

            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Room Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Design Sync Room"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Room PIN (Optional)
              </label>
              <input
                type="text"
                placeholder="Leave blank for public open room"
                value={newRoomPin}
                onChange={(e) => setNewRoomPin(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="flex-1 py-2 rounded-lg border border-surface-300 dark:border-surface-700 text-xs font-medium hover:bg-surface-100 dark:hover:bg-surface-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm"
              >
                Create Room
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
