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
      grid.innerHTML = '';
      if (!res.peers || !res.peers.length) {
        const empty = document.createElement('div');
        empty.className = 'panel';
        empty.style.gridColumn = '1/-1';
        empty.style.textAlign = 'center';
        empty.style.padding = '3rem 1rem';
        empty.innerHTML = `
          <div style="font-size:24px; margin-bottom:0.5rem; color:var(--text-dim); font-family:var(--font-mono);">[Radar]</div>
          <div style="font-weight:600; font-size:14px; margin-bottom:0.25rem;">No Active SecureDrop Peers Detected</div>
          <p style="color:var(--text-muted); font-size:12px; max-width:400px; margin:0 auto 1rem;">
            Ensure the other machine is running SecureDrop on the same subnet and UDP port 45678 is unblocked.
          </p>
        `;
        const probeBtn = document.createElement('button');
        probeBtn.className = 'btn btn-sm btn-primary';
        probeBtn.textContent = 'Send Broadcast Probe';
        probeBtn.onclick = () => el('probeBtn').click();
        empty.appendChild(probeBtn);
        grid.appendChild(empty);
        return;
      }

      for (const p of res.peers) {
        const isTrusted = !!p.trusted;
        const isBlocked = !!p.blocked;
        let primaryUrl = p.urls?.[0] || '';
        if (!primaryUrl.startsWith('http://') && !primaryUrl.startsWith('https://')) {
          primaryUrl = '';
        }

        const card = document.createElement('div');
        card.className = 'panel';
        card.style.gap = '0.75rem';

        const headerRow = document.createElement('div');
        headerRow.style.display = 'flex';
        headerRow.style.justifyContent = 'space-between';
        headerRow.style.alignItems = 'flex-start';

        const titleBox = document.createElement('div');
        const nameEl = document.createElement('div');
        nameEl.style.fontWeight = '700';
        nameEl.style.fontSize = '15px';
        nameEl.style.color = 'var(--text-main)';
        nameEl.textContent = p.name || 'Unknown Peer';

        const idEl = document.createElement('div');
        idEl.className = 'mono';
        idEl.style.fontSize = '11px';
        idEl.style.color = 'var(--text-dim)';
        idEl.textContent = p.device_id || '';

        titleBox.appendChild(nameEl);
        titleBox.appendChild(idEl);

        const badge = document.createElement('span');
        badge.className = `badge ${isBlocked ? 'badge-red' : isTrusted ? 'badge-emerald' : 'badge-cyan'}`;
        badge.textContent = isBlocked ? 'Blocked' : isTrusted ? 'Trusted' : 'Discovered';

        headerRow.appendChild(titleBox);
        headerRow.appendChild(badge);
        card.appendChild(headerRow);

        const metaBox = document.createElement('div');
        metaBox.className = 'mono';
        metaBox.style.fontSize = '12px';
        metaBox.style.color = 'var(--text-muted)';
        metaBox.style.lineHeight = '1.5';

        const webDiv = document.createElement('div');
        webDiv.textContent = 'Web: ';
        if (primaryUrl) {
          const webLink = document.createElement('a');
          webLink.href = primaryUrl;
          webLink.target = '_blank';
          webLink.rel = 'noopener noreferrer';
          webLink.style.color = 'var(--accent-cyan)';
          webLink.style.textDecoration = 'none';
          webLink.textContent = primaryUrl;
          webDiv.appendChild(webLink);
        } else {
          webDiv.appendChild(document.createTextNode('--'));
        }

        const tcpDiv = document.createElement('div');
        tcpDiv.textContent = `TCP: ${(p.tcp_addresses || []).join(', ') || '--'}`;

        const seenDiv = document.createElement('div');
        seenDiv.textContent = `Last Seen: ${p.last_seen ? new Date(p.last_seen * 1000).toLocaleTimeString() : '--'}`;

        metaBox.appendChild(webDiv);
        metaBox.appendChild(tcpDiv);
        metaBox.appendChild(seenDiv);
        card.appendChild(metaBox);

        const actionsRow = document.createElement('div');
        actionsRow.style.display = 'flex';
        actionsRow.style.gap = '0.5rem';
        actionsRow.style.marginTop = '0.25rem';
        actionsRow.style.borderTop = '1px solid var(--border-subtle)';
        actionsRow.style.paddingTop = '0.75rem';

        const trustBtn = document.createElement('button');
        trustBtn.className = `btn btn-sm ${isTrusted ? 'btn-amber' : ''}`;
        trustBtn.textContent = isTrusted ? 'Revoke Trust' : 'Trust';
        trustBtn.onclick = () => window.setTrust(p.device_id, p.name, !isTrusted, false);

        const blockBtn = document.createElement('button');
        blockBtn.className = 'btn btn-sm btn-danger';
        blockBtn.textContent = isBlocked ? 'Unblock' : 'Block';
        blockBtn.onclick = () => window.setTrust(p.device_id, p.name, false, !isBlocked);

        actionsRow.appendChild(trustBtn);
        actionsRow.appendChild(blockBtn);

        if (primaryUrl) {
          const connLink = document.createElement('a');
          connLink.href = primaryUrl;
          connLink.target = '_blank';
          connLink.rel = 'noopener noreferrer';
          connLink.className = 'btn btn-sm btn-primary';
          connLink.style.marginLeft = 'auto';
          connLink.textContent = 'Connect';
          actionsRow.appendChild(connLink);
        }

        card.appendChild(actionsRow);
        grid.appendChild(card);
      }
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
