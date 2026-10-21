/**
 * SecureDrop LAN — Admin Cockpit Engine
 */

(function () {
  const el = (id) => document.getElementById(id);

  const state = {
    storage: { page: 1, limit: 25, total: 0, pages: 1, search: '' },
    users: { page: 1, limit: 25, total: 0, pages: 1, search: '' },
    jobs: { page: 1, limit: 25, total: 0, pages: 1 },
    history: { page: 1, limit: 25, total: 0, pages: 1, filter: 'all' },
  };

  async function init() {
    await Common.initNavigation('admin');
    checkAdminAccess();
  }

  async function checkAdminAccess() {
    const auth = Common.state.auth;
    const badge = el('authStatusBadge');

    if (!auth || !auth.is_admin) {
      badge.textContent = 'Admin Verification Required';
      badge.className = 'badge badge-amber';
      el('loginGate').classList.remove('hidden');
      el('cockpitContent').classList.add('hidden');
      el('gateLoginBtn').onclick = () => Common.openAuthModal();
      return;
    }

    badge.textContent = 'Admin Session Active';
    badge.className = 'badge badge-emerald';
    el('loginGate').classList.add('hidden');
    el('cockpitContent').classList.remove('hidden');

    setupWebSocket();
    await loadTelemetry();
    await loadApprovals();
    await loadStorage();
    await loadUsers();
    await loadJobs();
    await loadHistory();
    setupEventListeners();
    setupModals();
  }

  function setupWebSocket() {
    Common.setupWebSocket((msg) => {
      if (msg.type === 'approval_requested') {
        Common.toast(`Incoming approval from ${msg.device_name}`, 'info');
        loadApprovals();
      }
      if (msg.type === 'job_update') {
        loadJobs();
      }
      if (msg.type === 'share_created' || msg.type === 'share_deleted' || msg.type === 'storage_cleared') {
        loadStorage();
        loadTelemetry();
      }
    });
  }

  async function loadTelemetry() {
    try {
      const info = await Common.api('/api/info');
      const storage = await Common.api('/api/storage/overview');

      el('statChunkBytes').textContent = Common.fmtBytes(storage.encrypted_chunk_bytes);
      el('statShareCount').textContent = `${storage.share_count} Active Stored Shares (Temp: ${Common.fmtBytes(storage.tmp_bytes)})`;

      el('statNodeName').textContent = info.device_name;
      el('statNodeFingerprint').textContent = `Fingerprint: ${info.fingerprint || '--'}`;

      if (el('cardShareCountBadge')) {
        el('cardShareCountBadge').textContent = `${storage.share_count} Shares`;
      }
    } catch (e) {
      console.warn('Telemetry error:', e);
    }
  }

  async function loadApprovals() {
    try {
      const showHistory = el('historyToggle')?.checked;
      const res = await Common.api(`/api/approvals${showHistory ? '?history=true' : ''}`);
      const container = el('approvalList');

      if (!res.approvals || !res.approvals.length) {
        container.innerHTML = `<div class="mono" style="color:var(--text-dim); text-align:center; padding:1.5rem;">No pending approval requests.</div>`;
        return;
      }

      container.innerHTML = res.approvals.map(a => `
        <div class="panel" style="background:var(--bg-void); padding:1rem; flex-direction:row; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:600; display:flex; align-items:center; gap:0.5rem;">
              ${Common.escapeHtml(a.device_name || 'Unknown Device')}
              <span class="badge ${a.status === 'accepted' ? 'badge-emerald' : a.status === 'rejected' ? 'badge-red' : 'badge-amber'}">
                ${a.status}
              </span>
            </div>
            <div class="mono" style="font-size:11px; color:var(--text-dim); margin-top:2px;">
              IP: ${Common.escapeHtml(a.requester_ip || '--')} · Share: ${Common.escapeHtml(a.share_token)} · Time: ${new Date(a.created_at * 1000).toLocaleTimeString()}
            </div>
          </div>
          <div style="display:flex; gap:0.5rem;">
            ${a.status === 'pending' ? `
              <button class="btn btn-sm btn-primary" onclick="window.decideApproval('${a.id}', 'accept')">Approve</button>
              <button class="btn btn-sm btn-danger" onclick="window.decideApproval('${a.id}', 'reject')">Deny</button>
            ` : `
              <span class="mono" style="font-size:11px; color:var(--text-dim);">Decided ${new Date(a.decided_at * 1000).toLocaleTimeString()}</span>
            `}
          </div>
        </div>
      `).join('');
    } catch (e) {
      console.warn('Approvals error:', e);
    }
  }

  window.decideApproval = async (id, decision) => {
    try {
      await Common.api(`/api/approvals/${id}/${decision}`, { method: 'POST' });
      Common.toast(`Approval ${decision}ed successfully`, 'success');
      loadApprovals();
    } catch (e) {
      Common.toast(e.message, 'error');
    }
  };

  function renderPagination(container, meta, onPage, onLimit) {
    if (!container) return;
    const start = meta.total > 0 ? (meta.page - 1) * meta.limit + 1 : 0;
    const end = Math.min(meta.total, meta.page * meta.limit);

    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.5rem;">
        <span>Rows:</span>
        <select class="page-size-select limit-select">
          <option value="25" ${meta.limit === 25 ? 'selected' : ''}>25</option>
          <option value="100" ${meta.limit === 100 ? 'selected' : ''}>100</option>
          <option value="200" ${meta.limit === 200 ? 'selected' : ''}>200</option>
        </select>
        <span>Showing ${start}–${end} of ${meta.total}</span>
      </div>
      <div class="pagination-controls">
        <button class="btn btn-sm btn-prev" ${meta.page <= 1 ? 'disabled' : ''}>&lt; Prev</button>
        <span class="mono" style="font-size:11px;">Page ${meta.page} of ${Math.max(1, meta.pages)}</span>
        <button class="btn btn-sm btn-next" ${meta.page >= meta.pages ? 'disabled' : ''}>Next &gt;</button>
      </div>
    `;

    container.querySelector('.limit-select').onchange = (e) => {
      onLimit(Number(e.target.value));
    };
    const prevBtn = container.querySelector('.btn-prev');
    if (prevBtn) prevBtn.onclick = () => onPage(meta.page - 1);
    const nextBtn = container.querySelector('.btn-next');
    if (nextBtn) nextBtn.onclick = () => onPage(meta.page + 1);
  }

  async function loadStorage() {
    try {
      const q = state.storage.search ? `&search=${encodeURIComponent(state.storage.search)}` : '';
      const res = await Common.api(`/api/storage/shares?page=${state.storage.page}&limit=${state.storage.limit}${q}`);
      state.storage.total = res.total || 0;
      state.storage.pages = res.pages || 1;

      if (el('cardShareCountBadge')) {
        el('cardShareCountBadge').textContent = `${state.storage.total} Shares`;
      }

      const tbody = el('modalStorageTableBody');
      if (tbody) {
        if (!res.shares || !res.shares.length) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-dim); padding:1.5rem;">No shares currently stored.</td></tr>`;
        } else {
          tbody.innerHTML = res.shares.map(s => `
            <tr>
              <td>
                <div style="font-weight:600;">${Common.escapeHtml(s.title || s.token)}</div>
                <div class="mono" style="font-size:11px; color:var(--text-dim);">${s.token}</div>
              </td>
              <td><span class="badge ${s.status === 'open' ? 'badge-emerald' : 'badge-amber'}">${s.status}</span></td>
              <td class="mono">${s.file_count || 0}</td>
              <td class="mono">${Common.fmtBytes(s.total_size || 0)}</td>
              <td class="mono">${Common.fmtBytes(s.stored_size || 0)}</td>
              <td class="mono" style="font-size:12px;">${new Date(s.created_at * 1000).toLocaleString()}</td>
              <td style="text-align:right;">
                <div style="display:inline-flex; align-items:center; gap:0.4rem;">
                  <span class="badge badge-cyan" style="font-size:10px;">[Audit Only]</span>
                  <button class="btn btn-sm btn-danger" onclick="window.deleteShare('${s.token}')">Scrub</button>
                </div>
              </td>
            </tr>
          `).join('');
        }
      }

      const onPage = (p) => { state.storage.page = p; loadStorage(); };
      const onLimit = (l) => { state.storage.limit = l; state.storage.page = 1; loadStorage(); };
      renderPagination(el('modalStoragePagination'), state.storage, onPage, onLimit);
    } catch (e) {
      console.warn('Storage error:', e);
    }
  }

  window.deleteShare = async (token) => {
    if (!confirm(`Delete all stored data and chunks for share ${token}?`)) return;
    try {
      await Common.api(`/api/storage/shares/${token}`, { method: 'DELETE' });
      Common.toast('Share and stored chunks deleted', 'success');
      loadStorage();
      loadTelemetry();
    } catch (e) {
      Common.toast(e.message, 'error');
    }
  };

  async function loadJobs() {
    try {
      const res = await Common.api(`/api/jobs?page=${state.jobs.page}&limit=${state.jobs.limit}`);
      state.jobs.total = res.total || 0;
      state.jobs.pages = res.pages || 1;

      if (el('cardJobsCountBadge')) {
        el('cardJobsCountBadge').textContent = `${state.jobs.total} Tasks`;
      }

      const container = el('modalJobsList');
      if (container) {
        if (!res.jobs || !res.jobs.length) {
          container.innerHTML = `<div class="mono" style="font-size:11px; color:var(--text-dim); padding:0.5rem 0;">No active background pull jobs.</div>`;
        } else {
          container.innerHTML = res.jobs.map(j => `
            <div class="panel" style="background:var(--bg-void); padding:0.75rem; gap:0.5rem;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <b style="font-size:13px;">${Common.escapeHtml(j.title || 'Pull Task')}</b>
                <span class="badge ${j.status === 'done' ? 'badge-emerald' : j.status === 'failed' ? 'badge-red' : 'badge-amber'}">${j.status}</span>
              </div>
              <div class="meter-progress" style="margin:0;">
                <div class="meter-fill" style="width:${Math.min(100, j.progress || 0)}%;"></div>
              </div>
              <div class="mono" style="font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between;">
                <span>${(j.progress || 0).toFixed(1)}% · ${Common.fmtSpeed(j.speed_bps || 0)}</span>
                <span>ETA: ${Common.fmtTime(j.eta_seconds || 0)}</span>
              </div>
              <div style="font-size:11px; color:var(--text-dim);">${Common.escapeHtml(j.detail || '')}</div>
            </div>
          `).join('');
        }
      }

      const onPage = (p) => { state.jobs.page = p; loadJobs(); };
      const onLimit = (l) => { state.jobs.limit = l; state.jobs.page = 1; loadJobs(); };
      renderPagination(el('modalJobsPagination'), state.jobs, onPage, onLimit);
    } catch (e) {
      console.warn('Jobs error:', e);
    }
  }

  async function loadHistory() {
    try {
      const dir = state.history.filter !== 'all' ? `&direction=${state.history.filter}` : '';
      const res = await Common.api(`/api/history?page=${state.history.page}&limit=${state.history.limit}${dir}`);
      state.history.total = res.total || 0;
      state.history.pages = res.pages || 1;

      if (el('cardAuditCountBadge')) {
        el('cardAuditCountBadge').textContent = `${state.history.total} Records`;
      }

      const container = el('modalHistoryList');
      if (container) {
        if (!res.history || !res.history.length) {
          container.innerHTML = `<div class="mono" style="color:var(--text-dim); text-align:center; padding:1.5rem;">No transfer history.</div>`;
        } else {
          container.innerHTML = res.history.map(h => `
            <div style="padding:8px; border-bottom:1px solid var(--border-subtle); display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-weight:500; font-size:13px;">${Common.escapeHtml(h.title || h.direction)}</div>
                <div class="mono" style="font-size:11px; color:var(--text-dim);">${Common.escapeHtml(h.detail || '')}</div>
              </div>
              <div style="text-align:right;">
                <span class="badge ${h.status === 'done' || h.status === 'open' ? 'badge-emerald' : 'badge-amber'}">${h.status}</span>
                <div class="mono" style="font-size:11px; color:var(--text-dim); margin-top:2px;">
                  ${new Date(h.created_at * 1000).toLocaleTimeString()}
                </div>
              </div>
            </div>
          `).join('');
        }
      }

      const onPage = (p) => { state.history.page = p; loadHistory(); };
      const onLimit = (l) => { state.history.limit = l; state.history.page = 1; loadHistory(); };
      renderPagination(el('modalHistoryPagination'), state.history, onPage, onLimit);
    } catch (e) {
      console.warn('History error:', e);
    }
  }

  async function loadUsers() {
    try {
      const q = state.users.search ? `&search=${encodeURIComponent(state.users.search)}` : '';
      const res = await Common.api(`/api/admin/users?page=${state.users.page}&limit=${state.users.limit}${q}`);
      state.users.total = res.total || 0;
      state.users.pages = res.pages || 1;

      if (el('cardUserCountBadge')) {
        el('cardUserCountBadge').textContent = `${state.users.total} Users`;
      }

      const tbody = el('modalUserTableBody');
      if (tbody) {
        if (!res.users || !res.users.length) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-dim); padding:1.5rem;">No user accounts found.</td></tr>`;
        } else {
          tbody.innerHTML = res.users.map(u => `
            <tr>
              <td>
                <div style="font-weight:600;">${Common.escapeHtml(u.username)}</div>
              </td>
              <td>${Common.escapeHtml(u.display_name || '--')}</td>
              <td>
                <select onchange="window.changeRole('${u.id}', this.value)" style="padding:2px 6px; font-size:12px; background:var(--bg-void); color:var(--text-main); border:1px solid var(--border);">
                  <option value="member" ${u.role === 'member' ? 'selected' : ''}>Member</option>
                  <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                  <option value="readonly" ${u.role === 'readonly' ? 'selected' : ''}>Read-Only</option>
                </select>
              </td>
              <td><span class="badge ${u.status === 'active' ? 'badge-emerald' : 'badge-amber'}">${u.status}</span></td>
              <td class="mono">${u.share_count || 0}</td>
              <td class="mono" style="font-size:12px;">${new Date(u.created_at * 1000).toLocaleDateString()}</td>
              <td style="text-align:right;">
                <button class="btn btn-sm btn-danger" onclick="window.deleteUser('${u.id}', '${Common.escapeAttr(u.username)}')">Delete</button>
              </td>
            </tr>
          `).join('');
        }
      }

      const onPage = (p) => { state.users.page = p; loadUsers(); };
      const onLimit = (l) => { state.users.limit = l; state.users.page = 1; loadUsers(); };
      renderPagination(el('modalUserPagination'), state.users, onPage, onLimit);
    } catch (e) {
      console.warn('Users error:', e);
    }
  }

  window.changeRole = async (userId, newRole) => {
    try {
      await Common.api(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      });
      Common.toast(`User role changed to ${newRole}`, 'success');
      loadUsers();
    } catch (e) {
      Common.toast(e.message, 'error');
    }
  };

  window.deleteUser = async (userId, username) => {
    if (!confirm(`Delete user account "${username}"? Active shares owned by this user will remain isolated.`)) return;
    try {
      await Common.api(`/api/admin/users/${userId}`, { method: 'DELETE' });
      Common.toast(`User account "${username}" deleted`, 'success');
      loadUsers();
    } catch (e) {
      Common.toast(e.message, 'error');
    }
  };

  function setupModals() {
    const modalMap = {
      btnOpenStorageModal: 'modalStorageAudit',
      btnOpenUserModal: 'modalUserRbac',
      btnOpenPullModal: 'modalNodePull',
      btnOpenAuditModal: 'modalAuditLogs',
    };

    Object.entries(modalMap).forEach(([btnId, modalId]) => {
      const btn = el(btnId);
      const modal = el(modalId);
      if (btn && modal) {
        btn.onclick = () => modal.classList.remove('hidden');
      }
    });

    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.onclick = () => {
        const modalId = btn.getAttribute('data-close');
        if (modalId && el(modalId)) el(modalId).classList.add('hidden');
      };
    });

    document.querySelectorAll('.modal-overlay').forEach(modal => {
      modal.onclick = (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      };
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
      }
    });

    // Search and filter listeners inside modals
    if (el('modalStorageSearch')) {
      el('modalStorageSearch').oninput = (e) => {
        state.storage.search = e.target.value.trim();
        state.storage.page = 1;
        loadStorage();
      };
    }
    if (el('modalStorageRefreshBtn')) el('modalStorageRefreshBtn').onclick = () => loadStorage();
    if (el('modalStoragePurgeBtn')) {
      el('modalStoragePurgeBtn').onclick = async () => {
        if (!confirm('CAUTION: This will delete ALL stored shares, files, and chunks from server disk. Proceed?')) return;
        try {
          await Common.api('/api/storage/all', { method: 'DELETE' });
          Common.toast('All storage purged cleanly', 'success');
          loadStorage();
          loadTelemetry();
        } catch (e) {
          Common.toast(e.message, 'error');
        }
      };
    }

    if (el('modalUserSearch')) {
      el('modalUserSearch').oninput = (e) => {
        state.users.search = e.target.value.trim();
        state.users.page = 1;
        loadUsers();
      };
    }
    if (el('modalAddUserBtn')) {
      el('modalAddUserBtn').onclick = async () => {
        const username = prompt('Enter new username (3-32 characters):');
        if (!username) return;
        const displayName = prompt('Enter display name:') || username;
        const password = prompt('Enter user password (minimum 6 characters):');
        if (!password) return;
        const role = prompt('Enter role (member, admin, or readonly):', 'member') || 'member';

        try {
          await Common.api('/api/admin/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              username: username.trim(),
              display_name: displayName.trim(),
              password,
              role: role.trim()
            })
          });
          Common.toast(`User "${username}" created`, 'success');
          loadUsers();
        } catch (e) {
          Common.toast(e.message, 'error');
        }
      };
    }

    if (el('modalRefreshJobsBtn')) el('modalRefreshJobsBtn').onclick = () => loadJobs();
    if (el('modalStartPullBtn')) {
      el('modalStartPullBtn').onclick = async () => {
        const baseUrl = el('modalPullBaseUrl').value.trim();
        const token = el('modalPullToken').value.trim();
        const key = el('modalPullKey').value.trim();
        const password = el('modalPullPassword').value;

        if (!baseUrl || !token) {
          return Common.toast('Remote Node URL and Share Token are required', 'error');
        }

        try {
          await Common.api('/api/pulls/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              base_url: baseUrl,
              token,
              key: key || null,
              password: password || null
            })
          });
          Common.toast('Background pull task started', 'success');
          loadJobs();
        } catch (e) {
          Common.toast(e.message, 'error');
        }
      };
    }

    if (el('modalHistoryFilterSelect')) {
      el('modalHistoryFilterSelect').onchange = (e) => {
        state.history.filter = e.target.value;
        state.history.page = 1;
        loadHistory();
      };
    }
    if (el('modalRefreshHistoryBtn')) el('modalRefreshHistoryBtn').onclick = () => loadHistory();
  }

  function setupEventListeners() {
    if (el('historyToggle')) el('historyToggle').onchange = () => loadApprovals();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
