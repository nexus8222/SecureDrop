/**
 * SecureDrop LAN — Production Shared Utility & Navigation Engine
 */

const Common = (() => {
  const state = {
    info: null,
    user: { username: 'guest', display_name: 'Guest User', role: 'guest' },
    auth: { is_admin: false, logged_in: false },
    ws: null,
  };

  const ThemeManager = {
    getTheme() {
      return localStorage.getItem('sd_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    },
    setTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('sd_theme', theme);
      const icon = theme === 'light' ? '○' : '●';
      const label = theme === 'light' ? 'Light Mode' : 'Dark Mode';
      document.querySelectorAll('.theme-toggle-icon').forEach(el => el.textContent = icon);
      document.querySelectorAll('.theme-toggle-label').forEach(el => el.textContent = label);
    },
    toggle() {
      const cur = document.documentElement.getAttribute('data-theme') || this.getTheme();
      const next = cur === 'light' ? 'dark' : 'light';
      this.setTheme(next);
      toast(`Theme set to ${next} mode`, 'info', 1500);
    },
    init() {
      this.setTheme(this.getTheme());
    }
  };

  // Immediate theme execution on script load to prevent visual flash
  try { ThemeManager.init(); } catch {}

  const SidebarManager = {
    isCollapsed() {
      return localStorage.getItem('sd_sidebar_collapsed') === 'true';
    },
    setCollapsed(collapsed) {
      const sidebar = document.querySelector('.sidebar');
      const shell = document.querySelector('.app-shell');
      if (sidebar) sidebar.classList.toggle('collapsed', collapsed);
      if (shell) shell.classList.toggle('sidebar-collapsed', collapsed);
      localStorage.setItem('sd_sidebar_collapsed', collapsed ? 'true' : 'false');
      const btn = document.getElementById('sidebarCollapseBtn');
      if (btn) btn.textContent = collapsed ? '◧' : '◨';
    },
    toggle() {
      this.setCollapsed(!this.isCollapsed());
    },
    init() {
      if (this.isCollapsed()) {
        this.setCollapsed(true);
      }
    }
  };

  function getUserScope() {
    if (state.user && state.user.id) return `u_${state.user.id}`;
    if (state.auth && state.auth.is_admin) return 'admin';
    return 'guest';
  }

  const StateManager = {
    getScopeKey(prefix, pageKey) {
      return `sd_${prefix}_${getUserScope()}_${pageKey}`;
    },
    saveDraft(pageKey, data) {
      try {
        sessionStorage.setItem(this.getScopeKey('draft', pageKey), JSON.stringify(data));
      } catch {}
    },
    getDraft(pageKey) {
      try {
        const raw = sessionStorage.getItem(this.getScopeKey('draft', pageKey));
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    clearDraft(pageKey) {
      try {
        sessionStorage.removeItem(this.getScopeKey('draft', pageKey));
        sessionStorage.removeItem(`sd_draft_${pageKey}`);
        localStorage.removeItem(`sd_draft_${pageKey}`);
      } catch {}
    },
    clearAllUserDrafts() {
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith('sd_draft_')) sessionStorage.removeItem(k);
        }
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith('sd_draft_')) localStorage.removeItem(k);
        }
      } catch {}
    },
    saveActiveUpload(data) {
      try {
        localStorage.setItem(`sd_active_up_${getUserScope()}`, JSON.stringify(data));
      } catch {}
    },
    getActiveUpload() {
      try {
        const raw = localStorage.getItem(`sd_active_up_${getUserScope()}`);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    clearActiveUpload() {
      try {
        localStorage.removeItem(`sd_active_up_${getUserScope()}`);
        localStorage.removeItem('sd_active_up_guest');
      } catch {}
    },
    autoTrack(pageKey, fields) {
      const draft = this.getDraft(pageKey) || {};
      fields.forEach(({ id, key, type }) => {
        const input = document.getElementById(id);
        if (!input) return;
        if (draft[key] !== undefined) {
          if (type === 'checkbox') input.checked = !!draft[key];
          else input.value = draft[key];
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const update = () => {
          const cur = this.getDraft(pageKey) || {};
          cur[key] = type === 'checkbox' ? input.checked : input.value;
          this.saveDraft(pageKey, cur);
        };
        input.addEventListener('input', update);
        input.addEventListener('change', update);
      });
    },
    addHostedShare(shareObj) {
      try {
        const key = `sd_shares_${getUserScope()}`;
        const list = this.getHostedShares();
        const existingIdx = list.findIndex(s => s.token === shareObj.token);
        if (existingIdx >= 0) list[existingIdx] = { ...list[existingIdx], ...shareObj };
        else list.unshift(shareObj);
        localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
      } catch {}
    },
    getHostedShares() {
      try {
        const key = `sd_shares_${getUserScope()}`;
        let raw = localStorage.getItem(key);
        if (!raw && getUserScope() === 'guest') {
          raw = localStorage.getItem('sd_hosted_shares');
        }
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    },
    removeHostedShare(token) {
      try {
        const key = `sd_shares_${getUserScope()}`;
        const list = this.getHostedShares().filter(s => s.token !== token);
        localStorage.setItem(key, JSON.stringify(list));
        if (getUserScope() === 'guest') {
          localStorage.removeItem('sd_hosted_shares');
        }
      } catch {}
    }
  };

  function hasClientCrypto() {
    return !!(window.crypto && crypto.subtle && window.isSecureContext);
  }

  function fmtBytes(bytes) {
    bytes = Number(bytes || 0);
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    return `${bytes.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  function fmtSpeed(bps) {
    return `${fmtBytes(bps)}/s`;
  }

  function fmtTime(sec) {
    sec = Math.max(0, Number(sec || 0));
    if (!isFinite(sec)) return '--';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function escapeAttr(s) {
    return String(s ?? '').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  }

  function b64urlFromBytes(bytes) {
    let bin = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function bytesFromB64url(s) {
    s = (s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function sha256Hex(buf) {
    if (!(window.crypto && crypto.subtle)) return null;
    try {
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;
    }
  }

  async function generateAesKey() {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const raw = await crypto.subtle.exportKey('raw', key);
    return { key, rawB64: b64urlFromBytes(raw) };
  }

  async function importAesKey(rawB64) {
    const raw = bytesFromB64url(rawB64);
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function encryptChunk(key, plainBuf) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plainBuf);
    const payload = new Uint8Array(nonce.length + cipher.byteLength);
    payload.set(nonce, 0);
    payload.set(new Uint8Array(cipher), 12);
    return { payload: payload.buffer, nonceB64: b64urlFromBytes(nonce) };
  }

  function toast(msg, type = 'info', timeout = 3500) {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      el.style.transition = 'all 200ms ease';
      setTimeout(() => el.remove(), 250);
    }, timeout);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard', 'success', 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Copied to clipboard', 'success', 2000);
    }
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      let text = await res.text();
      try { text = JSON.parse(text).detail || text; } catch {}
      throw new Error(text || `Request failed (${res.status})`);
    }
    return res.json();
  }

  function parseShareFragment(hash) {
    hash = (hash || window.location.hash || '').replace(/^#/, '');
    const params = new URLSearchParams(hash);
    return {
      key: params.get('key') || '',
      mode: params.get('mode') || (params.get('key') ? 'browser' : 'server'),
      ticket: params.get('ticket') || '',
    };
  }

  function setupWebSocket(onEvent) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    state.ws = new WebSocket(`${proto}://${location.host}/ws`);
    state.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (onEvent) onEvent(msg);
      } catch (e) {
        console.warn('WS error:', e);
      }
    };
    state.ws.onclose = () => setTimeout(() => setupWebSocket(onEvent), 3000);
  }

  function getInitials(name) {
    if (!name) return 'GU';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  async function initNavigation(activeTab = 'send') {
    try {
      state.info = await api('/api/info');
      state.user = state.info?.user || { username: 'guest', display_name: 'Guest User', role: 'guest' };
    } catch (e) {
      console.warn('Init error:', e);
    }

    // Purge legacy unscoped draft storage to guarantee zero cross-account leakage
    try {
      sessionStorage.removeItem('sd_draft_send');
      sessionStorage.removeItem('sd_draft_clipboard');
      sessionStorage.removeItem('sd_draft_receive');
      localStorage.removeItem('sd_draft_send');
      localStorage.removeItem('sd_draft_clipboard');
      localStorage.removeItem('sd_draft_receive');
    } catch {}

    // Service Worker auto-update for LAN clients
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.update().catch(() => {});
      }).catch(() => {});
    }

    const primaryIp = state.info?.node_ips?.[0] || 'LAN';
    const port = state.info?.web_port || 8000;
    const role = state.user.role || 'guest';
    const isAdmin = role === 'admin' || state.info?.role === 'admin';
    state.auth = {
      is_admin: isAdmin,
      logged_in: role !== 'guest',
      user: state.user,
    };
    const initials = getInitials(state.user.display_name || state.user.username);
    const roleBadgeClass = isAdmin ? 'badge-emerald' : role === 'member' ? 'badge-cyan' : 'badge-amber';

    // Inject Navigation Sidebar & Mobile Headers if not already present
    let shell = document.querySelector('.app-shell');
    if (!shell) {
      const main = document.querySelector('.page-wrapper') || document.querySelector('main');
      shell = document.createElement('div');
      shell.className = 'app-shell';
      document.body.insertBefore(shell, main);

      const appMain = document.createElement('div');
      appMain.className = 'app-main';
      appMain.appendChild(main);
      shell.appendChild(appMain);
    }

    // Top Mobile Header
    let mobileHeader = document.querySelector('.mobile-header');
    if (!mobileHeader) {
      mobileHeader = document.createElement('header');
      mobileHeader.className = 'mobile-header';
      mobileHeader.innerHTML = `
        <button id="mobileMenuBtn" class="mobile-menu-btn" aria-label="Open Navigation">⊞</button>
        <a href="/" class="mobile-brand">
          <span class="brand-monogram">SD</span>
          <span class="mobile-brand-title">SecureDrop</span>
        </a>
        <div style="display:flex; align-items:center; gap:0.4rem; margin-left:auto;">
          <button id="mobileThemeBtn" class="btn btn-sm" style="padding:2px 8px; font-size:12px;">
            <span class="theme-toggle-icon">${ThemeManager.getTheme() === 'light' ? '○' : '●'}</span>
          </button>
          <span class="badge ${roleBadgeClass}">${role.toUpperCase()}</span>
        </div>
      `;
      shell.insertBefore(mobileHeader, shell.firstChild);
    }

    // Backdrop for Mobile Drawer
    let backdrop = document.querySelector('.drawer-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'drawer-backdrop hidden';
      shell.appendChild(backdrop);
    }

    // Sidebar
    let sidebar = document.querySelector('.sidebar');
    if (!sidebar) {
      sidebar = document.createElement('aside');
      sidebar.className = 'sidebar';
      sidebar.innerHTML = `
        <div class="sidebar-brand">
          <div class="brand-monogram">SD</div>
          <div class="brand-meta">
            <div class="brand-name">SecureDrop</div>
            <div class="brand-sub">Enterprise LAN v2.4</div>
          </div>
          <button id="closeSidebarBtn" class="close-sidebar-btn" aria-label="Close Navigation">×</button>
        </div>

        <nav class="sidebar-nav">
          <div class="nav-section-title">Terminals</div>
          <a href="/send" class="sidebar-item ${activeTab === 'send' ? 'active' : ''}" data-tab="send" title="Send Payload">
            <span class="nav-icon">↑</span>
            <span class="nav-label">Send Payload</span>
          </a>
          <a href="/receive" class="sidebar-item ${activeTab === 'receive' ? 'active' : ''}" data-tab="receive" title="Receive with PIN">
            <span class="nav-icon">↓</span>
            <span class="nav-label">Receive (PIN)</span>
          </a>
          <a href="/shares" class="sidebar-item ${activeTab === 'shares' ? 'active' : ''}" data-tab="shares" title="My Hosted Shares">
            <span class="nav-icon">⊞</span>
            <span class="nav-label">Hosted Shares</span>
          </a>
          <a href="/clipboard" class="sidebar-item ${activeTab === 'clipboard' ? 'active' : ''}" data-tab="clipboard" title="Clipboard Exchange">
            <span class="nav-icon">≡</span>
            <span class="nav-label">Clipboard</span>
          </a>
          <div class="nav-section-title" style="margin-top:0.5rem;">Infrastructure</div>
          <a href="/peers" class="sidebar-item ${activeTab === 'peers' ? 'active' : ''}" data-tab="peers" title="LAN Radar">
            <span class="nav-icon">⇄</span>
            <span class="nav-label">LAN Radar</span>
          </a>
          <a href="/admin" class="sidebar-item admin-link ${activeTab === 'admin' ? 'active' : ''}" data-tab="admin" title="Admin Cockpit">
            <span class="nav-icon">⊞</span>
            <span class="nav-label">Admin Cockpit</span>
          </a>
        </nav>

        <div class="sidebar-footer">
          <div class="user-card" id="userCard">
            <div class="user-avatar" id="userAvatar">${initials}</div>
            <div class="user-info">
              <div class="user-name" id="userName">${escapeHtml(state.user.display_name || state.user.username)}</div>
              <div class="user-role-badge">
                <span class="badge ${roleBadgeClass}">${role.toUpperCase()}</span>
              </div>
            </div>
            <button id="userAuthBtn" class="user-auth-btn" title="${role === 'guest' ? 'Sign In / Register' : 'Logout'}">
              ${role === 'guest' ? `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Sign In">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                  <polyline points="10 17 15 12 10 7"></polyline>
                  <line x1="15" y1="12" x2="3" y2="12"></line>
                </svg>
              ` : `
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Logout Door">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
              `}
            </button>
          </div>

          <div class="node-live-status">
            <span class="pulse-dot"></span>
            <span class="mono" style="font-size:11px;">Node Active</span>
          </div>
        </div>
      `;
      shell.insertBefore(sidebar, shell.children[1]);
    }

    // Inject Desktop Header Bar if not present
    let desktopHeader = document.querySelector('.desktop-header');
    if (!desktopHeader) {
      const pageWrapper = document.querySelector('.page-wrapper') || document.querySelector('main');
      if (pageWrapper) {
        desktopHeader = document.createElement('div');
        desktopHeader.className = 'desktop-header';
        const pageTitleMap = {
          send: 'Send Terminal',
          receive: 'Receive Terminal',
          shares: 'Hosted Shares Dashboard',
          clipboard: 'Clipboard & Snippet Exchange',
          peers: 'LAN Peer Radar',
          admin: 'Security Audit Cockpit'
        };
        const pageTitle = pageTitleMap[activeTab] || 'SecureDrop LAN';

        desktopHeader.innerHTML = `
          <div class="header-breadcrumb">
            <button id="sidebarCollapseBtn" class="sidebar-toggle-btn" title="Toggle Sidebar">${SidebarManager.isCollapsed() ? '◧' : '◨'}</button>
            <span style="font-weight:600; font-size:14px; color:var(--text-main); margin-left:0.5rem;">${pageTitle}</span>
          </div>
          <div class="header-actions">
            <button id="headerThemeBtn" class="btn btn-sm" style="padding:4px 10px; gap:6px;" title="Toggle Theme (Dark / Light)">
              <span class="theme-toggle-icon">${ThemeManager.getTheme() === 'light' ? '○' : '●'}</span>
              <span class="theme-label" style="font-size:12px;">${ThemeManager.getTheme() === 'light' ? 'Light' : 'Dark'}</span>
            </button>
            <div class="node-live-status" style="border:1px solid var(--border); padding:4px 8px; border-radius:var(--radius-sm); background:var(--bg-panel); display:flex; align-items:center; gap:6px;">
              <span class="pulse-dot"></span>
              <span class="mono" style="font-size:11px;">Node Active</span>
            </div>
          </div>
        `;
        pageWrapper.insertBefore(desktopHeader, pageWrapper.firstChild);
      }
    }

    // Mobile Bottom Bar
    let bottomBar = document.querySelector('.mobile-bottom-bar');
    if (!bottomBar) {
      bottomBar = document.createElement('nav');
      bottomBar.className = 'mobile-bottom-bar';
      bottomBar.innerHTML = `
        <a href="/send" class="bottom-tab ${activeTab === 'send' ? 'active' : ''}" data-tab="send">
          <span class="bottom-icon">↑</span>
          <span class="bottom-label">Send</span>
        </a>
        <a href="/receive" class="bottom-tab ${activeTab === 'receive' ? 'active' : ''}" data-tab="receive">
          <span class="bottom-icon">↓</span>
          <span class="bottom-label">Receive</span>
        </a>
        <a href="/shares" class="bottom-tab ${activeTab === 'shares' ? 'active' : ''}" data-tab="shares">
          <span class="bottom-icon">⊞</span>
          <span class="bottom-label">Shares</span>
        </a>
        <a href="/clipboard" class="bottom-tab ${activeTab === 'clipboard' ? 'active' : ''}" data-tab="clipboard">
          <span class="bottom-icon">≡</span>
          <span class="bottom-label">Clip</span>
        </a>
        <a href="/admin" class="bottom-tab ${activeTab === 'admin' ? 'active' : ''}" data-tab="admin">
          <span class="bottom-icon">⊞</span>
          <span class="bottom-label">Admin</span>
        </a>
      `;
      shell.appendChild(bottomBar);
    }

    // Wire Up Mobile Drawer
    const menuBtn = document.getElementById('mobileMenuBtn');
    const closeBtn = document.getElementById('closeSidebarBtn');
    if (menuBtn && sidebar && backdrop) {
      menuBtn.onclick = () => {
        sidebar.classList.add('drawer-open');
        backdrop.classList.remove('hidden');
      };
      if (closeBtn) {
        closeBtn.onclick = () => {
          sidebar.classList.remove('drawer-open');
          backdrop.classList.add('hidden');
        };
      }
      backdrop.onclick = () => {
        sidebar.classList.remove('drawer-open');
        backdrop.classList.add('hidden');
      };
    }

    // Wire Up Auth Button
    const userAuthBtn = document.getElementById('userAuthBtn');
    if (userAuthBtn) {
      userAuthBtn.onclick = () => {
        if (state.user.role === 'guest') {
          openAuthModal();
        } else {
          if (confirm(`Logout from account "${state.user.username}"?`)) {
            StateManager.clearAllUserDrafts();
            api('/api/auth/logout', { method: 'POST' }).then(() => location.reload());
          }
        }
      };
    }

    // Wire Up Theme & Sidebar Controls
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) themeBtn.onclick = () => ThemeManager.toggle();
    const headerThemeBtn = document.getElementById('headerThemeBtn');
    if (headerThemeBtn) headerThemeBtn.onclick = () => ThemeManager.toggle();
    const mobileThemeBtn = document.getElementById('mobileThemeBtn');
    if (mobileThemeBtn) mobileThemeBtn.onclick = () => ThemeManager.toggle();

    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    if (collapseBtn) collapseBtn.onclick = () => SidebarManager.toggle();

    // Initialize sidebar state
    SidebarManager.init();

    // Track active page route in localStorage
    try {
      localStorage.setItem('sd_active_tab', activeTab);
    } catch {}
  }

  function openAuthModal(defaultTab = 'login') {
    let modal = document.getElementById('authModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'authModal';
      modal.className = 'modal-overlay hidden';
      modal.innerHTML = `
        <div class="modal-box">
          <div class="modal-header">
            <h3 id="authModalTitle">SecureDrop Authentication</h3>
            <button id="closeAuthBtn" class="btn btn-sm">Close</button>
          </div>

          <div style="display:flex; gap:0.5rem; border-bottom:1px solid var(--border-subtle); padding-bottom:0.75rem;">
            <button id="authTabLogin" class="btn btn-sm btn-primary">Sign In</button>
            <button id="authTabRegister" class="btn btn-sm">Create Account</button>
          </div>

          <!-- Login Form -->
          <form id="loginForm" onsubmit="return false;" style="display:flex; flex-direction:column; gap:0.75rem; margin-top:0.5rem;">
            <div class="form-group" style="margin:0;">
              <label>Username / Account</label>
              <input id="loginUsername" placeholder="e.g. admin or username" autocomplete="username" />
            </div>
            <div class="form-group" style="margin:0;">
              <label>Password</label>
              <input id="loginPassword" type="password" placeholder="Account password" autocomplete="current-password" />
            </div>
            <button id="submitLoginBtn" class="btn btn-primary btn-lg" style="margin-top:0.5rem;">Sign In</button>
          </form>

          <!-- Register Form -->
          <form id="registerForm" onsubmit="return false;" class="hidden" style="display:flex; flex-direction:column; gap:0.75rem; margin-top:0.5rem;">
            <div class="form-group" style="margin:0;">
              <label>Choose Username</label>
              <input id="regUsername" placeholder="Unique username" autocomplete="username" />
            </div>
            <div class="form-group" style="margin:0;">
              <label>Display Name</label>
              <input id="regDisplayName" placeholder="e.g. Alice Smith" />
            </div>
            <div class="form-group" style="margin:0;">
              <label>Password</label>
              <input id="regPassword" type="password" placeholder="Minimum 6 characters" autocomplete="new-password" />
            </div>
            <button id="submitRegisterBtn" class="btn btn-primary btn-lg" style="margin-top:0.5rem;">Register Account</button>
          </form>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('closeAuthBtn').onclick = () => modal.classList.add('hidden');
      modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };

      const tabLogin = document.getElementById('authTabLogin');
      const tabReg = document.getElementById('authTabRegister');
      const formLogin = document.getElementById('loginForm');
      const formReg = document.getElementById('registerForm');

      tabLogin.onclick = () => {
        tabLogin.className = 'btn btn-sm btn-primary';
        tabReg.className = 'btn btn-sm';
        formLogin.classList.remove('hidden');
        formReg.classList.add('hidden');
      };

      tabReg.onclick = () => {
        tabReg.className = 'btn btn-sm btn-primary';
        tabLogin.className = 'btn btn-sm';
        formReg.classList.remove('hidden');
        formLogin.classList.add('hidden');
      };

      document.getElementById('submitLoginBtn').onclick = async () => {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        if (!password) return toast('Password required', 'error');

        try {
          await api('/api/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: username || 'admin', password })
          });
          StateManager.clearAllUserDrafts();
          toast('Authenticated successfully', 'success');
          location.reload();
        } catch (e) {
          toast(e.message, 'error');
        }
      };

      document.getElementById('submitRegisterBtn').onclick = async () => {
        const username = document.getElementById('regUsername').value.trim();
        const displayName = document.getElementById('regDisplayName').value.trim();
        const password = document.getElementById('regPassword').value;
        if (!username || !password) return toast('Username and password required', 'error');

        try {
          await api('/api/auth/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, display_name: displayName, password })
          });
          toast('Account registered & logged in', 'success');
          location.reload();
        } catch (e) {
          toast(e.message, 'error');
        }
      };
    }

    modal.classList.remove('hidden');
  }

  return {
    state,
    hasClientCrypto,
    fmtBytes,
    fmtSpeed,
    fmtTime,
    escapeHtml,
    escapeAttr,
    b64urlFromBytes,
    bytesFromB64url,
    sha256Hex,
    generateAesKey,
    importAesKey,
    encryptChunk,
    toast,
    copyText,
    api,
    parseShareFragment,
    setupWebSocket,
    initNavigation,
    openAuthModal,
    ThemeManager,
    SidebarManager,
    StateManager,
    saveDraft: (k, d) => StateManager.saveDraft(k, d),
    getDraft: (k) => StateManager.getDraft(k),
    clearDraft: (k) => StateManager.clearDraft(k),
    clearAllUserDrafts: () => StateManager.clearAllUserDrafts(),
    autoTrack: (k, f) => StateManager.autoTrack(k, f),
    saveActiveUpload: (d) => StateManager.saveActiveUpload(d),
    getActiveUpload: () => StateManager.getActiveUpload(),
    clearActiveUpload: () => StateManager.clearActiveUpload(),
    addHostedShare: (s) => StateManager.addHostedShare(s),
    getHostedShares: () => StateManager.getHostedShares(),
    removeHostedShare: (t) => StateManager.removeHostedShare(t),
  };
})();

window.Common = Common;
