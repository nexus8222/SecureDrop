import React, { useState, useEffect } from 'react';
import { api } from './api';
import { AuthStatus } from './types';
import { Navbar } from './components/Navbar';
import { SendTerminal } from './components/SendTerminal';
import { ReceiveTerminal } from './components/ReceiveTerminal';
import { DirectSharesTerminal } from './components/DirectSharesTerminal';
import { HostedSharesTerminal } from './components/HostedSharesTerminal';
import { LiveRoomsTerminal } from './components/LiveRoomsTerminal';
import { RadarChatTerminal } from './components/RadarChatTerminal';
import { ClipboardTerminal } from './components/ClipboardTerminal';
import { MediaGalleryTerminal } from './components/MediaGalleryTerminal';
import { AdminCockpit } from './components/AdminCockpit';
import { Lock, LogIn, UserPlus } from 'lucide-react';

const validTabs = ['send', 'receive', 'inbox', 'shares', 'rooms', 'radar', 'clipboard', 'gallery', 'admin'];

export const App: React.FC = () => {
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  const getInitialTab = (): string => {
    const rawPath = window.location.pathname.replace(/^\/+/, '').split('/')[0];
    if (rawPath && validTabs.includes(rawPath)) {
      return rawPath;
    }
    const saved = localStorage.getItem('sd_active_tab');
    if (saved && validTabs.includes(saved)) {
      return saved;
    }
    return 'send';
  };

  const [activeTab, setActiveTabState] = useState<string>(getInitialTab);

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    localStorage.setItem('sd_active_tab', tab);
    if (window.location.pathname !== `/${tab}`) {
      window.history.pushState({ tab }, '', `/${tab}`);
    }
  };

  useEffect(() => {
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState({ tab: activeTab }, '', `/${activeTab}`);
    }

    const onPopState = () => {
      const rawPath = window.location.pathname.replace(/^\/+/, '').split('/')[0];
      if (rawPath && validTabs.includes(rawPath)) {
        setActiveTabState(rawPath);
        localStorage.setItem('sd_active_tab', rawPath);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [activeTab]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sd_sidebar_collapsed') === 'true';
  });

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('sd_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  });

  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  // Apply theme to html document element
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('sd_theme', theme);
  }, [theme]);

  // Save sidebar state
  useEffect(() => {
    localStorage.setItem('sd_sidebar_collapsed', sidebarCollapsed ? 'true' : 'false');
  }, [sidebarCollapsed]);

  // Screen WakeLock to prevent sleep during background transfers
  useEffect(() => {
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {}
    };
    requestWakeLock();

    return () => {
      if (wakeLock) wakeLock.release();
    };
  }, []);

  const fetchAuthStatus = async () => {
    try {
      const status = await api.getAuthStatus();
      setAuth(status);
    } catch {
      // Offline fallback guest
      setAuth({
        configured: true,
        role: 'guest',
        is_admin: false,
        authenticated: false,
        user: { id: 'gst_offline', username: 'OfflineGuest', display_name: 'Offline Guest', role: 'guest' },
        can_setup: false,
        guest_permissions: ['send', 'receive'],
        admin_permissions: [],
      });
    }
  };

  useEffect(() => {
    fetchAuthStatus();
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      fetchAuthStatus();
    } catch {}
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      if (authMode === 'login') {
        await api.login({ username: authUsername.trim(), password: authPassword });
      } else {
        await api.register({
          username: authUsername.trim(),
          password: authPassword,
          display_name: authDisplayName.trim() || undefined,
        });
      }
      setShowAuthModal(false);
      setAuthUsername('');
      setAuthPassword('');
      setAuthDisplayName('');
      fetchAuthStatus();
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed');
    }
  };

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 text-surface-900 dark:text-surface-100 flex flex-col font-sans transition-colors duration-200">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        auth={auth}
        onLogout={handleLogout}
        theme={theme}
        toggleTheme={toggleTheme}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      <div className="flex-1 flex">
        {/* Main Workspace Area with left margin matching sidebar */}
        <main
          className={`flex-1 transition-all duration-200 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full ${
            sidebarCollapsed ? 'ml-16' : 'ml-56'
          }`}
        >
          {/* Unauthenticated Guest Banner */}
          {auth && !auth.authenticated && (
            <div className="mb-6 p-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                <span>
                  Connected in guest session as <strong className="font-mono text-emerald-600 dark:text-emerald-400">{auth.user.username}</strong> (Quota: 2 GB).
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setAuthMode('login');
                    setShowAuthModal(true);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800 font-medium transition-colors"
                >
                  Sign In
                </button>
                <button
                  onClick={() => {
                    setAuthMode('register');
                    setShowAuthModal(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm transition-colors"
                >
                  Create Account
                </button>
              </div>
            </div>
          )}

          {/* Active Tab Router */}
          {activeTab === 'send' && <SendTerminal auth={auth} />}
          {activeTab === 'receive' && <ReceiveTerminal />}
          {activeTab === 'inbox' && <DirectSharesTerminal />}
          {activeTab === 'shares' && <HostedSharesTerminal auth={auth} />}
          {activeTab === 'rooms' && <LiveRoomsTerminal auth={auth} />}
          {activeTab === 'radar' && <RadarChatTerminal auth={auth} />}
          {activeTab === 'clipboard' && <ClipboardTerminal />}
          {activeTab === 'gallery' && <MediaGalleryTerminal />}
          {activeTab === 'admin' && <AdminCockpit />}
        </main>
      </div>

      {/* Auth Modal (Login / Register) */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form
            onSubmit={handleAuthSubmit}
            className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl relative"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base flex items-center gap-2">
                <Lock size={16} className="text-emerald-500" />
                {authMode === 'login' ? 'Sign In to SecureDrop' : 'Create Member Account'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAuthModal(false)}
                className="text-surface-400 hover:text-surface-900 dark:hover:text-surface-100"
              >
                ✕
              </button>
            </div>

            {authError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs">
                {authError}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Username
              </label>
              <input
                type="text"
                required
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {authMode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                  Display Name (Optional)
                </label>
                <input
                  type="text"
                  value={authDisplayName}
                  onChange={(e) => setAuthDisplayName(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition-colors"
            >
              {authMode === 'login' ? 'Authenticate' : 'Register Account'}
            </button>

            <div className="text-center pt-1 text-xs text-surface-500">
              {authMode === 'login' ? (
                <span>
                  Need an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('register');
                      setAuthError(null);
                    }}
                    className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
                  >
                    Register
                  </button>
                </span>
              ) : (
                <span>
                  Already registered?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('login');
                      setAuthError(null);
                    }}
                    className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
                  >
                    Sign In
                  </button>
                </span>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
