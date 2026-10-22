import React from 'react';
import {
  Send,
  Download,
  Inbox,
  FolderSync,
  Layers,
  Radio,
  Clipboard,
  Image as ImageIcon,
  ShieldCheck,
  Sun,
  Moon,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Shield,
  HardDrive,
} from 'lucide-react';
import { AuthStatus } from '../types';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  auth: AuthStatus | null;
  onLogout: () => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  auth,
  onLogout,
  theme,
  toggleTheme,
  collapsed,
  setCollapsed,
}) => {
  const user = auth?.user;
  const isGuest = user?.role === 'guest';
  const isAdmin = auth?.is_admin || user?.role === 'admin';

  const quotaLimit = user?.storage_quota_bytes;
  const quotaUsed = user?.storage_used_bytes || 0;
  const quotaPercent = quotaLimit ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;

  const navItems = [
    { id: 'send', label: 'Send Files', icon: Send },
    { id: 'receive', label: 'Receive Files', icon: Download },
    { id: 'inbox', label: 'Direct Shares', icon: Inbox },
    { id: 'shares', label: 'Hosted Shares', icon: FolderSync },
    { id: 'rooms', label: 'Live Drop-Boxes', icon: Layers },
    { id: 'radar', label: 'LAN Radar & Chat', icon: Radio },
    { id: 'clipboard', label: 'Secure Notepad', icon: Clipboard },
    { id: 'gallery', label: 'Media Gallery', icon: ImageIcon },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin Cockpit', icon: ShieldCheck }] : []),
  ];

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <>
      {/* Topbar */}
      <header className="h-16 border-b border-surface-200 dark:border-surface-800 bg-white/80 dark:bg-surface-900/80 backdrop-blur-md px-4 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-600 dark:text-surface-400 transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <Shield size={18} />
            </div>
            <div className="flex flex-col">
              <span className="font-bold tracking-tight text-sm md:text-base leading-none">
                SecureDrop <span className="text-emerald-600 dark:text-emerald-400">LAN</span>
              </span>
              <span className="text-[10px] text-surface-500 uppercase tracking-widest font-mono">v2.5 Enterprise</span>
            </div>
          </div>
        </div>

        {/* User Badges & Topbar Controls */}
        <div className="flex items-center gap-3">
          {/* Storage Quota Gauge */}
          {user && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 text-xs font-mono">
              <HardDrive size={13} className="text-surface-400" />
              <span>
                {formatBytes(quotaUsed)} / {quotaLimit ? formatBytes(quotaLimit) : 'Unlimited'}
              </span>
              {quotaLimit && (
                <div className="w-12 h-1.5 rounded-full bg-surface-200 dark:bg-surface-800 overflow-hidden">
                  <div
                    className={`h-full ${quotaPercent > 90 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                    style={{ width: `${quotaPercent}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* User Account / Role Badge */}
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-surface-100 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700/50 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-medium truncate max-w-[140px] text-surface-700 dark:text-surface-300">
              {user ? (isGuest ? `Guest: ${user.username}` : user.display_name || user.username) : 'Connecting...'}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                isAdmin
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                  : isGuest
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
              }`}
            >
              {user?.role || 'Guest'}
            </span>
          </div>

          {/* Theme Switcher (Only in Topbar) */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg border border-surface-200 dark:border-surface-800 hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-600 dark:text-surface-400 transition-colors"
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Logout Button with Exit Door Symbol */}
          {auth?.authenticated && (
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium transition-colors"
              title="Sign Out of Session"
            >
              {/* Door SVG symbol */}
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13 4h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
                <path d="M2 20h20" />
                <path d="M13 20V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16" />
                <path d="M10 12h.01" />
              </svg>
              <span className="hidden sm:inline">Logout</span>
            </button>
          )}
        </div>
      </header>

      {/* Sidebar Navigation */}
      <aside
        className={`fixed top-16 bottom-0 left-0 z-30 transition-all duration-200 border-r border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/60 backdrop-blur-md flex flex-col justify-between py-4 ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <nav className="flex flex-col gap-1 px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800/60 hover:text-surface-900 dark:hover:text-surface-100'
                }`}
                title={item.label}
              >
                <Icon size={18} className={active ? 'text-emerald-600 dark:text-emerald-400' : ''} />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Security Status Footnote */}
        {!collapsed && (
          <div className="px-4 py-2 border-t border-surface-200 dark:border-surface-800/80 text-[11px] text-surface-500 flex flex-col gap-1">
            <span className="flex items-center gap-1.5 font-medium text-surface-700 dark:text-surface-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Air-Gapped Intranet
            </span>
            <span className="font-mono text-[10px]">E2EE + BLAKE2b Chunks</span>
          </div>
        )}
      </aside>
    </>
  );
};
