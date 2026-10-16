/**
 * SecureDrop LAN — Peer Radar Engine
 */

(function () {
  const el = (id) => document.getElementById(id);

  async function init() {
    await Common.initNavigation('peers');
    setupWebSocket();
    setupControls();
    await loadPeers();
  }

  function setupWebSocket() {
    Common.setupWebSocket((msg) => {
      if (msg.type === 'peer_seen') {
        loadPeers();
      }
    });
  }

  function setupControls() {
    el('refreshBtn').onclick = () => loadPeers();
    el('probeBtn').onclick = async () => {
      try {
        await Common.api('/api/discovery/probe', { method: 'POST' });
        Common.toast('Discovery probe broadcasted on UDP 45678', 'info');
        setTimeout(loadPeers, 800);
      } catch (e) {
        Common.toast(e.message, 'error');
      }
    };
  }

  async function loadPeers() {
    const grid = el('peersGrid');
    try {
      const res = await Common.api('/api/discovery/peers');
      if (!res.peers || !res.peers.length) {
        grid.innerHTML = `
          <div class="panel" style="grid-column:1/-1; text-align:center; padding:3rem 1rem;">
            <div style="font-size:28px; margin-bottom:0.5rem; color:var(--text-dim);">📡</div>
            <div style="font-weight:600; font-size:14px; margin-bottom:0.25rem;">No Active SecureDrop Peers Detected</div>
            <p style="color:var(--text-muted); font-size:12px; max-width:400px; margin:0 auto 1rem;">
              Ensure the other machine is running SecureDrop on the same subnet and UDP port 45678 is unblocked.
            </p>
            <button class="btn btn-sm btn-primary" onclick="document.getElementById('probeBtn').click()">Send Broadcast Probe</button>
          </div>
        `;
        return;
      }

      grid.innerHTML = res.peers.map(p => {
        const isTrusted = !!p.trusted;
        const isBlocked = !!p.blocked;
        const primaryUrl = p.urls?.[0] || '#';

        return `
          <div class="panel" style="gap:0.75rem;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <div>
                <div style="font-weight:700; font-size:15px; color:var(--text-main);">${Common.escapeHtml(p.name)}</div>
                <div class="mono" style="font-size:11px; color:var(--text-dim);">${p.device_id}</div>
              </div>
              <span class="badge ${isBlocked ? 'badge-red' : isTrusted ? 'badge-emerald' : 'badge-cyan'}">
                ${isBlocked ? 'Blocked' : isTrusted ? 'Trusted' : 'Discovered'}
              </span>
            </div>

            <div class="mono" style="font-size:12px; color:var(--text-muted); line-height:1.5;">
              <div>Web: <a href="${primaryUrl}" target="_blank" style="color:var(--accent-cyan); text-decoration:none;">${primaryUrl}</a></div>
              <div>TCP: ${p.tcp_addresses?.join(', ') || '--'}</div>
              <div>Last Seen: ${new Date(p.last_seen * 1000).toLocaleTimeString()}</div>
            </div>

            <div style="display:flex; gap:0.5rem; margin-top:0.25rem; border-top:1px solid var(--border-subtle); padding-top:0.75rem;">
              <button class="btn btn-sm ${isTrusted ? 'btn-amber' : ''}" onclick="window.setTrust('${p.device_id}', '${Common.escapeAttr(p.name)}', ${!isTrusted}, false)">
                ${isTrusted ? 'Revoke Trust' : 'Trust'}
              </button>
              <button class="btn btn-sm btn-danger" onclick="window.setTrust('${p.device_id}', '${Common.escapeAttr(p.name)}', false, ${!isBlocked})">
                ${isBlocked ? 'Unblock' : 'Block'}
              </button>
              <a href="${primaryUrl}" target="_blank" class="btn btn-sm btn-primary" style="margin-left:auto;">Connect</a>
            </div>
          </div>
        `;
      }).join('');
    } catch (e) {
      grid.innerHTML = `
        <div class="panel" style="grid-column:1/-1; text-align:center; padding:2rem 1rem;">
          <div class="mono" style="color:var(--accent-amber);">${Common.escapeHtml(e.message)}</div>
          <div style="font-size:12px; color:var(--text-dim); margin-top:0.5rem;">Admin login required to view network peer topology.</div>
        </div>
      `;
    }
  }

  window.setTrust = async (deviceId, name, trusted, blocked) => {
    try {
      await Common.api('/api/trust', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, name, trusted, blocked })
      });
      Common.toast('Peer security trust updated', 'success');
      loadPeers();
    } catch (e) {
      Common.toast(e.message, 'error');
    }
  };

  window.addEventListener('DOMContentLoaded', init);
})();
