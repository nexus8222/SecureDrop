import {
  AuthStatus,
  ShareItem,
  PeerDevice,
  GroupItem,
  GroupMember,
  CollabRoom,
  ChatMessage,
  ClipboardItem,
  DirectShareInboxItem,
  ChunksStatusResponse,
} from './types';

const BASE_URL = '';

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  // Include credentials for sessions & cookies
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let errorDetail = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson && errJson.detail) {
        errorDetail = errJson.detail;
      }
    } catch {
      // ignore
    }
    throw new Error(errorDetail);
  }

  return res.json();
}

export const api = {
  // Auth
  getAuthStatus: () => fetchJson<AuthStatus>('/api/auth/status'),
  getAuthMe: () => fetchJson<{ authenticated: boolean; user: any }>('/api/auth/me'),
  getGuestId: () => fetchJson<any>('/api/auth/guest-id'),
  login: (data: { username?: string; password: string }) =>
    fetchJson<{ ok: boolean; role: string; user: any }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  register: (data: { username: string; password: string; display_name?: string }) =>
    fetchJson<{ ok: boolean; role: string; user: any }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  logout: () => fetchJson<{ ok: boolean; role: string }>('/api/auth/logout', { method: 'POST' }),
  setup: (password: string) =>
    fetchJson<{ ok: boolean; role: string }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  // Shares
  createShare: (data: any) =>
    fetchJson<{ ok: boolean; token: string; pin: string; upload_token: string }>('/api/shares', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  registerFile: (token: string, fileData: any, uploadToken?: string) =>
    fetchJson<{ ok: boolean; file_id: string }>(`/api/shares/${token}/files`, {
      method: 'POST',
      headers: uploadToken ? { 'x-upload-token': uploadToken } : {},
      body: JSON.stringify(fileData),
    }),
  getChunksStatus: (token: string) => fetchJson<ChunksStatusResponse>(`/api/shares/${token}/chunks-status`),
  saveManifest: (token: string, manifest: any, uploadToken?: string) =>
    fetchJson<{ ok: boolean }>(`/api/shares/${token}/manifest`, {
      method: 'POST',
      headers: uploadToken ? { 'x-upload-token': uploadToken } : {},
      body: JSON.stringify({ manifest }),
    }),
  getManifest: (token: string) => fetchJson<{ token: string; manifest: any }>(`/api/shares/${token}/manifest`),
  listMyShares: (tokens?: string[]) =>
    fetchJson<{ shares: ShareItem[] }>(`/api/shares?${tokens ? `tokens=${tokens.join(',')}` : ''}`),
  getShareMeta: (token: string, ticket?: string) =>
    fetchJson<ShareItem>(`/api/shares/${token}${ticket ? `?ticket=${ticket}` : ''}`),
  getShareByPin: (pin: string) => fetchJson<ShareItem>(`/api/shares/by-pin/${pin}`),
  unlockShare: (token: string, data: { device_id?: string; device_name?: string; password?: string }) =>
    fetchJson<any>(`/api/shares/${token}/unlock`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteShare: (token: string, uploadToken?: string) =>
    fetchJson<{ ok: boolean }>(`/api/shares/${token}`, {
      method: 'DELETE',
      headers: uploadToken ? { 'x-upload-token': uploadToken } : {},
    }),

  // Groups & Direct Sharing
  listGroups: () => fetchJson<{ groups: GroupItem[] }>('/api/groups'),
  createGroup: (name: string, description?: string) =>
    fetchJson<{ ok: boolean; group_id: string; name: string }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  listGroupMembers: (groupId: string) =>
    fetchJson<{ members: GroupMember[] }>(`/api/groups/${groupId}/members`),
  addGroupMember: (groupId: string, username: string, role = 'member') =>
    fetchJson<{ ok: boolean; user_id: string; username: string }>(`/api/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ username, role }),
    }),
  removeGroupMember: (groupId: string, userId: string) =>
    fetchJson<{ ok: boolean }>(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
  searchUsers: (q: string) => fetchJson<{ users: any[] }>(`/api/users/search?q=${encodeURIComponent(q)}`),
  createDirectShare: (shareToken: string, groupId?: string, recipientUsernames?: string[]) =>
    fetchJson<{ ok: boolean; recipients_count: number }>('/api/shares/direct', {
      method: 'POST',
      body: JSON.stringify({
        share_token: shareToken,
        group_id: groupId || null,
        recipient_usernames: recipientUsernames || [],
      }),
    }),
  listDirectInbox: () => fetchJson<{ shares: DirectShareInboxItem[] }>('/api/shares/direct/inbox'),

  // Collaborative Rooms
  listRooms: () => fetchJson<{ rooms: CollabRoom[] }>('/api/rooms'),
  createRoom: (name: string, pin?: string, expiresSeconds = 86400) =>
    fetchJson<{ ok: boolean; room_id: string; name: string }>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name, pin: pin || null, expires_seconds: expiresSeconds }),
    }),
  getRoom: (roomId: string, pin?: string) =>
    fetchJson<CollabRoom>(`/api/rooms/${roomId}${pin ? `?pin=${encodeURIComponent(pin)}` : ''}`),
  addRoomItem: (roomId: string, shareToken: string, senderName?: string) =>
    fetchJson<{ ok: boolean; item_id: string }>(`/api/rooms/${roomId}/items`, {
      method: 'POST',
      body: JSON.stringify({ share_token: shareToken, sender_name: senderName || null }),
    }),
  deleteRoom: (roomId: string) =>
    fetchJson<{ ok: boolean; deleted: string }>(`/api/rooms/${roomId}`, { method: 'DELETE' }),

  // Ephemeral Chat
  getChat: (channel: string) => fetchJson<{ messages: ChatMessage[] }>(`/api/chat/${channel}`),
  sendChat: (channel: string, text: string, senderName?: string) =>
    fetchJson<{ ok: boolean; message: ChatMessage }>(`/api/chat/${channel}`, {
      method: 'POST',
      body: JSON.stringify({ text, sender_name: senderName || null }),
    }),

  // Directional Clipboard Push & Notes
  pushClipboard: (text: string, targetDeviceId?: string, targetUsername?: string) =>
    fetchJson<{ ok: boolean; id: string }>('/api/clipboard/push', {
      method: 'POST',
      body: JSON.stringify({ text, target_device_id: targetDeviceId, target_username: targetUsername }),
    }),
  getClipboardItem: (cid: string) => fetchJson<{ item: ClipboardItem }>(`/api/clipboard/${cid}`),
  deleteClipboardItem: (cid: string) => fetchJson<{ ok: boolean }>(`/api/clipboard/${cid}`, { method: 'DELETE' }),

  // LAN Radar & Discovery
  listPeers: () => fetchJson<{ peers: PeerDevice[] }>('/api/discovery/peers'),
  probePeers: () => fetchJson<{ ok: boolean }>('/api/discovery/probe', { method: 'POST' }),
  getVisibility: () => fetchJson<{ visibility: 'everyone' | 'contacts' | 'hidden' }>('/api/user/visibility'),
  setVisibility: (visibility: 'everyone' | 'contacts' | 'hidden') =>
    fetchJson<{ ok: boolean; visibility: string }>('/api/user/visibility', {
      method: 'POST',
      body: JSON.stringify({ visibility }),
    }),
  pairRequest: (targetDeviceId: string) =>
    fetchJson<{ ok: boolean; request_id: string; pin: string }>('/api/peers/pair/request', {
      method: 'POST',
      body: JSON.stringify({ target_device_id: targetDeviceId }),
    }),
  pairVerify: (requestId: string, pin: string) =>
    fetchJson<{ ok: boolean; message: string }>('/api/peers/pair/verify', {
      method: 'POST',
      body: JSON.stringify({ request_id: requestId, pin }),
    }),

  // Admin Cockpit & Modals (Paginated 25 / 100 / 200)
  adminGetUsers: (page = 1, limit = 25, search?: string) =>
    fetchJson<any>(`/api/admin/users?page=${page}&limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  adminUpdateUserRole: (userId: string, role?: string, status?: string) =>
    fetchJson<any>(`/api/admin/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role, status }),
    }),
  adminDeleteUser: (userId: string) => fetchJson<any>(`/api/admin/users/${userId}`, { method: 'DELETE' }),
  adminGetStorageAudit: (page = 1, limit = 25, status?: string) =>
    fetchJson<any>(`/api/storage/shares?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`),
  adminGetStorageOverview: () => fetchJson<any>('/api/storage/overview'),
  adminGetAuditLogs: (page = 1, limit = 25) => fetchJson<any>(`/api/history?page=${page}&limit=${limit}`),
  adminGetNodePulls: (page = 1, limit = 25) => fetchJson<any>(`/api/jobs?page=${page}&limit=${limit}`),
};
