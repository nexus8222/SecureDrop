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
        <button id="mobileMenuBtn" class="mobile-menu-btn" aria-label="Open Navigation">☰</button>
        <a href="/" class="mobile-brand">
          <span class="brand-monogram">SD</span>
          <span class="mobile-brand-title">SecureDrop</span>
        </a>
        <span class="badge ${roleBadgeClass}">${role.toUpperCase()}</span>
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
            <div class="brand-sub">LAN Cockpit v2.3</div>
          </div>
          <button id="closeSidebarBtn" class="close-sidebar-btn" aria-label="Close Navigation">✕</button>
        </div>

        <nav class="sidebar-nav">
          <div class="nav-section-title">Navigation</div>
          <a href="/send" class="sidebar-item ${activeTab === 'send' ? 'active' : ''}" data-tab="send">
            <span class="nav-icon">⬆</span>
            <span class="nav-label">Send Payload</span>
          </a>
          <a href="/receive" class="sidebar-item ${activeTab === 'receive' ? 'active' : ''}" data-tab="receive">
            <span class="nav-icon">⬇</span>
            <span class="nav-label">Receive (PIN)</span>
          </a>
          <a href="/peers" class="sidebar-item ${activeTab === 'peers' ? 'active' : ''}" data-tab="peers">
            <span class="nav-icon">📡</span>
            <span class="nav-label">LAN Radar</span>
          </a>
          <a href="/clipboard" class="sidebar-item ${activeTab === 'clipboard' ? 'active' : ''}" data-tab="clipboard">
            <span class="nav-icon">📋</span>
            <span class="nav-label">Clipboard</span>
          </a>
          <a href="/admin" class="sidebar-item admin-link ${activeTab === 'admin' ? 'active' : ''}" data-tab="admin">
            <span class="nav-icon">⚙</span>
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
              ${role === 'guest' ? '➔' : '⏻'}
            </button>
          </div>

          <div class="node-live-status">
            <span class="pulse-dot"></span>
            <span class="mono" style="font-size:11px;">${escapeHtml(primaryIp)}:${port}</span>
          </div>
        </div>
      `;
      shell.insertBefore(sidebar, shell.children[1]);
    }

    // Mobile Bottom Bar
    let bottomBar = document.querySelector('.mobile-bottom-bar');
    if (!bottomBar) {
      bottomBar = document.createElement('nav');
      bottomBar.className = 'mobile-bottom-bar';
      bottomBar.innerHTML = `
        <a href="/send" class="bottom-tab ${activeTab === 'send' ? 'active' : ''}" data-tab="send">
          <span class="bottom-icon">⬆</span>
          <span class="bottom-label">Send</span>
        </a>
        <a href="/receive" class="bottom-tab ${activeTab === 'receive' ? 'active' : ''}" data-tab="receive">
          <span class="bottom-icon">⬇</span>
          <span class="bottom-label">Receive</span>
        </a>
        <a href="/peers" class="bottom-tab ${activeTab === 'peers' ? 'active' : ''}" data-tab="peers">
          <span class="bottom-icon">📡</span>
          <span class="bottom-label">Radar</span>
        </a>
        <a href="/clipboard" class="bottom-tab ${activeTab === 'clipboard' ? 'active' : ''}" data-tab="clipboard">
          <span class="bottom-icon">📋</span>
          <span class="bottom-label">Clip</span>
        </a>
        <a href="/admin" class="bottom-tab ${activeTab === 'admin' ? 'active' : ''}" data-tab="admin">
          <span class="bottom-icon">⚙</span>
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
            api('/api/auth/logout', { method: 'POST' }).then(() => location.reload());
          }
        }
      };
    }
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
  };
})();

window.Common = Common;
