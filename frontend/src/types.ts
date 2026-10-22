export interface UserProfile {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'member' | 'guest';
  status?: string;
  storage_quota_bytes?: number | null;
  storage_used_bytes?: number;
}

export interface AuthStatus {
  configured: boolean;
  role: 'admin' | 'member' | 'guest';
  is_admin: boolean;
  authenticated: boolean;
  user: UserProfile;
  can_setup: boolean;
  guest_permissions: string[];
  admin_permissions: string[];
}

export interface FileItem {
  id: string;
  name: string;
  relative_path: string;
  size: number;
  mime: string;
  chunk_size: number;
  chunk_count: number;
  compression: string;
  file_sha256?: string;
}

export interface ShareItem {
  token: string;
  pin: string;
  title: string;
  mode: string;
  created_at: number;
  expires_at?: number | null;
  status: string;
  downloads: number;
  max_downloads?: number;
  is_owner?: boolean;
  can_delete?: boolean;
  admin_audit_only?: boolean;
  file_count?: number;
  total_size?: number;
  stored_size?: number;
  files?: FileItem[];
  meta?: Record<string, any>;
}

export interface PeerDevice {
  device_id: string;
  name: string;
  ips: string[];
  urls: string[];
  web_port: number;
  tcp_port: number;
  last_seen: number;
  trusted: boolean | number;
  blocked: boolean | number;
  fingerprint?: string;
  visibility?: 'everyone' | 'contacts' | 'hidden';
}

export interface GroupItem {
  id: string;
  name: string;
  description?: string;
  created_by?: string;
  created_at: number;
  member_count?: number;
}

export interface GroupMember {
  id: string;
  username: string;
  display_name: string;
  user_role: string;
  group_role: string;
  joined_at: number;
}

export interface CollabRoom {
  id: string;
  name: string;
  has_pin?: boolean;
  host_user_id?: string;
  created_at: number;
  expires_at?: number | null;
  item_count?: number;
  items?: RoomItem[];
}

export interface RoomItem {
  id: string;
  share_token: string;
  sender_name: string;
  created_at: number;
  title?: string;
  share_pin?: string;
  status?: string;
}

export interface ChatMessage {
  id: string;
  channel: string;
  sender_id: string;
  sender_name: string;
  text: string;
  created_at: number;
}

export interface ClipboardItem {
  id: string;
  text: string;
  created_at: number;
  expires_at?: number | null;
}

export interface DirectShareInboxItem {
  direct_share_id: string;
  shared_at: number;
  share_status: string;
  token: string;
  pin: string;
  title: string;
  mode: string;
  sender_name: string;
  group_name?: string | null;
}

export interface ChunksStatusResponse {
  token: string;
  status: string;
  files: {
    file_id: string;
    name: string;
    size: number;
    chunk_size: number;
    chunk_count: number;
    uploaded_count: number;
    uploaded_indices: number[];
    missing_indices: number[];
    is_complete: boolean;
  }[];
}
