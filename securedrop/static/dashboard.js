/**
 * SecureDrop LAN — Admin Cockpit Engine
 */

(function () {
  const el = (id) => document.getElementById(id);

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

      const webUrls = (info.web_urls || []).join(' · ');
      el('statEndpoints').textContent = `${webUrls} (TCP: ${info.tcp_port})`;
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
        container.innerHTML = `<div class="mono" style="color:var(--text-dim); text-align:center; padding:1.5rem;">No approval requests found.</div>`;
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
              <button class="btn btn-sm btn-primary" onclick="window.decide('${a.id}','accept')">Accept</button>
              <button class="btn btn-sm btn-danger" onclick="window.decide('${a.id}','reject')">Reject</button>
            ` : `
              <span class="mono" style="font-size:11px; color:var(--text-dim);">${new Date((a.decided_at || a.created_at) * 1000).toLocaleTimeString()}</span>
            `}
          </div>
        </div>
      `).join('');
    } catch (e) {
      console.warn('Approvals error:', e);
    }
  }

  window.decide = async (id, decision) => {
    try {
      await Common.api(`/api/approvals/${id}/${decision}`, { method: 'POST' });
      Common.toast(`Approval ${decision}ed`, 'success');
      loadApprovals();
    } catch (e) {
      Common.toast(e.message, 'error');
    }
  };

  async function loadStorage() {
    try {
      const res = await Common.api('/api/storage/overview');
      const tbody = el('storageTableBody');

      if (!res.shares || !res.shares.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-dim); padding:1.5rem;">No shares currently stored.</td></tr>`;
        return;
      }

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
            <button class="btn btn-sm btn-danger" onclick="window.deleteShare('${s.token}')">Delete</button>
          </td>
        </tr>
      `).join('');
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
      const res = await Common.api('/api/jobs');
      const container = el('jobsList');

      if (!res.jobs || !res.jobs.length) {
        container.innerHTML = `<div class="mono" style="font-size:11px; color:var(--text-dim); padding:0.5rem 0;">No active background pull jobs.</div>`;
        return;
      }

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
    } catch (e) {
      console.warn('Jobs error:', e);
    }
  }

  async function loadHistory() {
    try {
      const res = await Common.api('/api/history');
      const container = el('historyList');

      if (!res.history || !res.history.length) {
        container.innerHTML = `<div class="mono" style="color:var(--text-dim); text-align:center; padding:1.5rem;">No transfer history.</div>`;
        return;
      }

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
    } catch (e) {
      console.warn('History error:', e);
    }
  }

  async function loadUsers() {
    try {
      const res = await Common.api('/api/admin/users');
      const tbody = el('userTableBody');
      if (!res.users || !res.users.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-dim); padding:1.5rem;">No user accounts found.</td></tr>';
        return;
      }
      tbody.innerHTML = res.users.map(u => `
        <tr>
          <td><span class="mono" style="font-weight:600;">${Common.escapeHtml(u.username)}</span></td>
          <td>${Common.escapeHtml(u.display_name || '--')}</td>
          <td>
            <select class="btn btn-sm" onchange="window.changeUserRole('${u.id}', this.value)" style="padding:2px 6px; font-size:11px; background:var(--bg-void);">
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
              <option value="member" ${u.role === 'member' ? 'selected' : ''}>member</option>
              <option value="guest" ${u.role === 'guest' ? 'selected' : ''}>guest</option>
            </select>
          </td>
          <td>
            <span class="badge ${u.status === 'active' ? 'badge-emerald' : 'badge-amber'}">${u.status}</span>
          </td>
          <td class="mono">${u.share_count || 0}</td>
          <td class="mono" style="font-size:11px; color:var(--text-dim);">${new Date(u.created_at * 1000).toLocaleDateString()}</td>
          <td style="text-align:right;">
            ${u.username !== 'admin' ? `
              <button class="btn btn-sm btn-danger" onclick="window.deleteUser('${u.id}', '${Common.escapeAttr(u.username)}')">Delete</button>
            ` : '<span class="mono" style="font-size:11px; color:var(--text-dim);">Root</span>'}
          </td>
        </tr>
      `).join('');
    } catch (e) {
      console.warn('Users error:', e);
    }
  }

  window.changeUserRole = async (userId, role) => {
    try {
      await Common.api(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role })
      });
      Common.toast(`User role updated to ${role}`, 'success');
      loadUsers();
    } catch (e) {
      Common.toast(e.message, 'error');
    }
  };

  window.deleteUser = async (userId, username) => {
    if (!confirm(`Permanently remove user "${username}"?`)) return;
    try {
      await Common.api(`/api/admin/users/${userId}`, { method: 'DELETE' });
      Common.toast(`User ${username} removed`, 'success');
      loadUsers();
    } catch (e) {
      Common.toast(e.message, 'error');
    }
  };

  function setupEventListeners() {
    el('historyToggle').onchange = () => loadApprovals();
    el('refreshStorageBtn').onclick = () => loadStorage();
    el('refreshHistoryBtn').onclick = () => loadHistory();

    const addBtn = el('addUserBtn');
    if (addBtn) {
      addBtn.onclick = async () => {
        const username = prompt('Enter new username (3-32 characters):');
        if (!username) return;
        const displayName = prompt('Enter display name:') || username;
        const password = prompt('Enter user password (minimum 6 characters):');
        if (!password) return;
        const role = prompt('Enter role (member or admin):', 'member') || 'member';

        try {
          await Common.api('/api/admin/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, display_name: displayName, password, role })
          });
          Common.toast(`User ${username} created`, 'success');
          loadUsers();
        } catch (e) {
          Common.toast(e.message, 'error');
        }
      };
    }

    el('purgeAllBtn').onclick = async () => {
      if (!confirm('DANGER: This will permanently delete ALL stored shares, encrypted chunks, and temporary files on this node. Continue?')) {
        return;
      }
      try {
        await Common.api('/api/storage/all', { method: 'DELETE' });
        Common.toast('All server storage permanently wiped', 'success');
        loadStorage();
        loadTelemetry();
      } catch (e) {
        Common.toast(e.message, 'error');
      }
    };

    el('startPullBtn').onclick = async () => {
      const baseUrl = el('pullBaseUrl').value.trim();
      const token = el('pullToken').value.trim();
      const key = el('pullKey').value.trim();
      const password = el('pullPassword').value || null;

      if (!baseUrl || !token) {
        return Common.toast('Sender URL and Token required', 'error');
      }

      try {
        await Common.api('/api/pulls/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            base_url: baseUrl,
            token,
            key_b64: key,
            password,
            parallelism: 4
          })
        });
        Common.toast('Background pull task initiated', 'success');
        loadJobs();
      } catch (e) {
        Common.toast(e.message, 'error');
      }
    };
  }

  window.addEventListener('DOMContentLoaded', init);
})();
