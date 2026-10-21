/**
 * SecureDrop LAN — Hosted Shares & Payload Management Terminal
 */

(function () {
  const el = (id) => document.getElementById(id);
  const state = {
    shares: [],
    filter: 'all',
    search: '',
  };

  async function init() {
    await Common.initNavigation('shares');
    setupWebSocket();
    setupControls();
    await loadShares();
  }

  function setupWebSocket() {
    Common.setupWebSocket((msg) => {
      if (['share_created', 'share_deleted', 'chunk_uploaded', 'download_complete'].includes(msg.type)) {
        loadShares(true);
      }
    });
  }

  function setupControls() {
    el('refreshSharesBtn').onclick = () => loadShares();

    el('shareSearchInput').addEventListener('input', (e) => {
      state.search = e.target.value.toLowerCase().trim();
      renderTable();
    });

    document.querySelectorAll('.pill-btn').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.filter = btn.getAttribute('data-filter') || 'all';
        renderTable();
      };
    });
  }

  async function loadShares(silent = false) {
    try {
      const localShares = Common.getHostedShares();
      const localTokens = localShares.map(s => s.token).filter(Boolean);
      const tokenParam = localTokens.length ? `?tokens=${encodeURIComponent(localTokens.join(','))}` : '';

      const res = await Common.api(`/api/shares/mine${tokenParam}`);
      let serverShares = res.shares || [];

      // Merge local client keys with server results so Zero-Knowledge links remain complete
      state.shares = serverShares.map(s => {
        const local = localShares.find(l => l.token === s.token);
        return {
          ...s,
          key: local?.key || s.key || null,
          upload_token: local?.upload_token || s.upload_token || null,
          clipboard_id: local?.clipboard_id || null,
        };
      });

      renderMetrics();
      renderTable();
    } catch (e) {
      if (!silent) Common.toast(`Failed to load shares: ${e.message}`, 'error');
      el('sharesTableBody').innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center; padding:2rem; color:var(--accent-red);">
            Error loading shares: ${Common.escapeHtml(e.message)}
          </td>
        </tr>
      `;
    }
  }

  function renderMetrics() {
    const active = state.shares.filter(s => s.status === 'open');
    const totalBytes = active.reduce((acc, s) => acc + Number(s.stored_size || s.total_size || 0), 0);
    const totalDownloads = state.shares.reduce((acc, s) => acc + Number(s.downloads || 0), 0);

    el('statShareCount').textContent = active.length;
    el('statTotalSize').textContent = Common.fmtBytes(totalBytes);
    el('statDownloads').textContent = totalDownloads;
  }

  function getExpirationBadge(s) {
    if (s.status === 'deleted') return '<span class="badge badge-red">Purged</span>';
    if (s.status === 'maxed') return '<span class="badge badge-amber">Limit Reached</span>';
    if (s.status === 'expired') return '<span class="badge badge-red">Expired</span>';

    if (!s.expires_at) return '<span class="mono" style="font-size:11px; color:var(--text-dim);">Permanent</span>';

    const remainingSec = s.expires_at - Math.floor(Date.now() / 1000);
    if (remainingSec <= 0) return '<span class="badge badge-red">Expired</span>';

    if (remainingSec < 3600) {
      const mins = Math.max(1, Math.floor(remainingSec / 60));
      return `<span class="badge badge-amber">${mins}m remaining</span>`;
    }
    const hrs = (remainingSec / 3600).toFixed(1);
    return `<span class="mono" style="font-size:11px; color:var(--text-muted);">${hrs}h left</span>`;
  }

  function renderTable() {
    const tbody = el('sharesTableBody');
    let list = state.shares;

    // Filter
    if (state.filter === 'files') {
      list = list.filter(s => s.mode === 'files');
    } else if (state.filter === 'clipboard') {
      list = list.filter(s => s.mode === 'clipboard');
    }

    // Search
    if (state.search) {
      list = list.filter(s => {
        const title = (s.title || '').toLowerCase();
        const pin = String(s.pin || '');
        const token = (s.token || '').toLowerCase();
        return title.includes(state.search) || pin.includes(state.search) || token.includes(state.search);
      });
    }

    if (!list.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center; padding:3.5rem 1rem;">
            <div style="font-size:28px; margin-bottom:0.75rem; color:var(--text-dim); font-family:var(--font-mono);">[Empty]</div>
            <div style="font-weight:600; font-size:15px; color:var(--text-main); margin-bottom:0.25rem;">
              ${state.search ? 'No matching payloads found' : 'No Hosted Shares Yet'}
            </div>
            <p style="color:var(--text-muted); font-size:12px; max-width:360px; margin:0 auto 1.25rem;">
              ${state.search ? 'Try clearing your search query or filter.' : 'Distribute files, directories, or encrypted clipboard text across your local network.'}
            </p>
            ${!state.search ? '<a href="/send" class="btn btn-primary btn-sm">+ Deploy New Payload</a>' : ''}
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map(s => {
      const isClip = s.mode === 'clipboard';
      const isDead = ['deleted', 'expired', 'maxed'].includes(s.status);
      const isZK = s.key && s.key !== 'server';
      const shareUrl = isZK
        ? `${location.origin}/share/${s.token}#key=${encodeURIComponent(s.key)}`
        : `${location.origin}/share/${s.token}`;

      const maxDl = Number(s.max_downloads || 0);
      const downloadsText = maxDl > 0 ? `${s.downloads || 0}/${maxDl}` : `${s.downloads || 0}`;

      return `
        <tr style="${isDead ? 'opacity:0.6;' : ''}">
          <td>
            <div style="font-weight:600; font-size:13px; color:var(--text-main); display:flex; align-items:center; gap:6px;">
              ${Common.escapeHtml(s.title || 'Untitled Payload')}
            </div>
            <div class="mono" style="font-size:11px; color:var(--text-dim); margin-top:2px;">
              ${s.token} · ${new Date(s.created_at * 1000).toLocaleTimeString()}
            </div>
          </td>
          <td>
            <span class="badge ${isClip ? 'badge-amber' : 'badge-cyan'}">
              ${isClip ? 'Snippet' : 'Files'}
            </span>
          </td>
          <td>
            <div class="pin-pill" style="cursor:pointer;" onclick="Common.copyText('${s.pin}')" title="Click to copy PIN">
              <span>${s.pin || '----'}</span>
              <span style="font-size:10px; opacity:0.7;">[Copy]</span>
            </div>
          </td>
          <td class="mono" style="font-size:12px;">
            ${isClip ? `${s.total_size || 0} Chars` : `${s.file_count || 1} files · ${Common.fmtBytes(s.total_size || s.stored_size || 0)}`}
          </td>
          <td class="mono" style="font-size:12px;">
            <span>${downloadsText}</span>
            ${s.delete_after_download ? '<span class="badge badge-amber" style="font-size:9px; margin-left:4px;">1-Time</span>' : ''}
          </td>
          <td>
            ${getExpirationBadge(s)}
          </td>
          <td>
            <div style="display:flex; flex-direction:column; gap:2px;">
              ${s.password_hash ? '<span class="badge badge-amber" style="font-size:10px;">Password</span>' : ''}
              ${s.require_approval ? '<span class="badge badge-cyan" style="font-size:10px;">Approval Gate</span>' : ''}
              ${!s.password_hash && !s.require_approval ? '<span class="mono" style="font-size:11px; color:var(--text-dim);">Direct</span>' : ''}
            </div>
          </td>
          <td style="text-align:right;">
            <div style="display:inline-flex; gap:0.4rem; align-items:center;">
              <button class="btn btn-sm" onclick="Common.copyText('${shareUrl}')" title="Copy Share Link">Copy Link</button>
              <a href="${shareUrl}" target="_blank" class="btn btn-sm" title="Open Share Receiver">Open</a>
              <button class="btn btn-sm btn-danger" onclick="window.revokeShare('${s.token}', '${s.clipboard_id || ''}', '${s.upload_token || ''}')" title="Immediately scrub all chunks from disk">Revoke</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.revokeShare = async (token, cid, uploadToken) => {
    if (!confirm(`Permanently revoke and purge this share? All stored chunk files will be immediately scrubbed from disk.`)) {
      return;
    }

    try {
      const headers = {};
      if (uploadToken) headers['x-upload-token'] = uploadToken;

      if (cid) {
        await Common.api(`/api/clipboard/${cid}`, { method: 'DELETE', headers });
      }
      await Common.api(`/api/shares/${token}`, { method: 'DELETE', headers });

      Common.removeHostedShare(token);
      Common.toast('Payload and stored chunks purged immediately', 'success', 3500);
      loadShares();
    } catch (e) {
      Common.toast(`Revoke failed: ${e.message}`, 'error', 5000);
    }
  };

  window.addEventListener('DOMContentLoaded', init);
})();
