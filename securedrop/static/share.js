/**
 * SecureDrop LAN — Share Download & Preview Terminal Engine
 */

(function () {
  const el = (id) => document.getElementById(id);
  const state = {
    token: '',
    key: '',
    ticket: '',
    meta: null,
  };

  async function init() {
    await Common.initNavigation('receive');

    // Parse token from pathname /share/{token}
    const match = window.location.pathname.match(/\/share\/([^\/]+)/);
    if (!match) {
      Common.toast('Invalid share URL', 'error');
      return;
    }
    state.token = match[1];

    // Parse key & ticket from hash fragment
    const frag = Common.parseShareFragment();
    state.key = frag.key;
    state.ticket = frag.ticket;

    setupWebSocket();
    setupModals();
    await loadShareMetadata();
  }

  function setupWebSocket() {
    Common.setupWebSocket((msg) => {
      if (msg.type === 'approval_decided' && msg.ticket === state.ticket) {
        if (msg.status === 'accepted') {
          Common.toast('Access granted by Host! Loading files...', 'success');
          el('approvalSpinner').classList.add('hidden');
          loadShareMetadata();
        } else {
          Common.toast('Access request rejected by Host', 'error', 6000);
          el('approvalSpinner').textContent = 'Access request rejected.';
        }
      }
      if (msg.type === 'chunk_uploaded' && msg.token === state.token) {
        // Live update chunk matrix
        loadShareMetadata(true);
      }
    });
  }

  async function loadShareMetadata(silent = false) {
    try {
      const ticketParam = state.ticket ? `?ticket=${encodeURIComponent(state.ticket)}` : '';
      const meta = await Common.api(`/api/shares/${state.token}${ticketParam}`);
      state.meta = meta;

      if (meta.locked) {
        renderLocked(meta);
        return;
      }

      el('lockCard').classList.add('hidden');
      el('contentPanel').classList.remove('hidden');
      renderUnlocked(meta);
    } catch (e) {
      if (!silent) Common.toast(e.message, 'error', 6000);
      el('shareTitle').textContent = 'Share Unavailable';
      el('shareMeta').textContent = e.message;
      el('readyBadge').textContent = 'Error';
      el('readyBadge').className = 'badge badge-red';
    }
  }

  function renderLocked(meta) {
    el('lockCard').classList.remove('hidden');
    el('contentPanel').classList.add('hidden');

    el('shareTitle').textContent = meta.title || 'Protected Share';
    el('shareMeta').textContent = `Created: ${new Date(meta.created_at * 1000).toLocaleString()}`;
    el('readyBadge').textContent = 'Locked';
    el('readyBadge').className = 'badge badge-amber';

    if (meta.requires_password) {
      el('passwordField').classList.remove('hidden');
    } else {
      el('passwordField').classList.add('hidden');
    }

    el('requestUnlockBtn').onclick = async () => {
      const password = el('unlockPasswordInput').value || null;
      try {
        const res = await Common.api(`/api/shares/${state.token}/unlock`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            password,
            device_name: navigator.userAgent.slice(0, 30)
          })
        });

        state.ticket = res.ticket;
        // Update URL hash with ticket
        const curHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        curHash.set('ticket', state.ticket);
        window.location.hash = curHash.toString();

        if (res.pending_approval) {
          el('approvalSpinner').classList.remove('hidden');
          Common.toast('Approval request sent to host node', 'info');
        } else {
          Common.toast('Access authorized', 'success');
          loadShareMetadata();
        }
      } catch (err) {
        Common.toast(err.message, 'error');
      }
    };
  }

  function renderUnlocked(meta) {
    el('shareTitle').textContent = meta.title || 'Secure Share';
    const totalBytes = (meta.files || []).reduce((a, f) => a + Number(f.size || 0), 0);
    const expiresText = meta.expires_at ? `Expires ${new Date(meta.expires_at * 1000).toLocaleTimeString()}` : 'Never expires';
    el('shareMeta').textContent = `${(meta.files || []).length} Files · ${Common.fmtBytes(totalBytes)} · ${expiresText}`;

    const isReady = (meta.files || []).length > 0 && (meta.files || []).every(f => f.uploaded_chunks >= f.chunk_count);
    el('readyBadge').textContent = isReady ? 'Verified & Ready' : 'Incomplete / Uploading';
    el('readyBadge').className = isReady ? 'badge badge-emerald' : 'badge badge-amber';

    // Download All as ZIP Button
    el('downloadZipBtn').onclick = () => {
      const keyParam = state.key ? `&key=${encodeURIComponent(state.key)}` : '';
      const ticketParam = state.ticket ? `&ticket=${encodeURIComponent(state.ticket)}` : '';
      window.location.href = `/api/shares/${state.token}/zip?download=1${keyParam}${ticketParam}`;
    };

    el('reloadBtn').onclick = () => loadShareMetadata();

    // Render File Manifest Table
    const tbody = el('fileTableBody');
    if (!meta.files || !meta.files.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-dim); padding:2rem;">No files registered.</td></tr>`;
      return;
    }

    tbody.innerHTML = meta.files.map(f => {
      const isFileReady = f.uploaded_chunks >= f.chunk_count;
      const keyParam = state.key ? `&key=${encodeURIComponent(state.key)}` : '';
      const ticketParam = state.ticket ? `&ticket=${encodeURIComponent(state.ticket)}` : '';
      const streamUrl = `/api/shares/${state.token}/files/${f.id}/stream?download=1${keyParam}${ticketParam}`;

      return `
        <tr>
          <td>
            <div class="file-name-cell">${Common.escapeHtml(f.name)}</div>
            <div class="file-path">${Common.escapeHtml(f.relative_path || f.name)}</div>
          </td>
          <td class="mono">${Common.fmtBytes(f.size)}</td>
          <td>
            <span class="badge ${isFileReady ? 'badge-emerald' : 'badge-amber'}">
              ${f.uploaded_chunks}/${f.chunk_count} Chunks
            </span>
          </td>
          <td style="text-align:right;">
            <div style="display:inline-flex; gap:0.4rem;">
              <button class="btn btn-sm" onclick="window.previewFile('${f.id}')" ${isFileReady ? '' : 'disabled'}>Preview</button>
              <a href="${streamUrl}" class="btn btn-sm btn-primary" ${isFileReady ? '' : 'style="pointer-events:none; opacity:0.4;"'}>Download</a>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Render Chunk Heatmap
    renderChunkHeatmap(meta.files);
  }

  function renderChunkHeatmap(files) {
    const matrixBox = el('chunkMatrix');
    matrixBox.innerHTML = '';
    let total = 0;
    let uploaded = 0;

    files.forEach(f => {
      for (let i = 0; i < f.chunk_count; i++) {
        total++;
        const isDone = i < f.uploaded_chunks;
        if (isDone) uploaded++;

        const block = document.createElement('div');
        block.className = `chunk-block ${isDone ? 'done' : 'pending'}`;
        block.title = `${f.name} Chunk ${i + 1}/${f.chunk_count} (${isDone ? 'Stored' : 'Pending'})`;
        matrixBox.appendChild(block);
      }
    });

    el('chunkCount').textContent = `${uploaded}/${total}`;
  }

  window.previewFile = async (fileId) => {
    const file = state.meta?.files?.find(f => f.id === fileId);
    if (!file) return;

    const modal = el('previewModal');
    const title = el('previewTitle');
    const body = el('previewBody');
    const copyBtn = el('copyPreviewTextBtn');

    title.textContent = file.name;
    body.innerHTML = `<div class="mono" style="color:var(--text-dim);">Loading preview...</div>`;
    copyBtn.classList.add('hidden');
    modal.classList.remove('hidden');

    const keyParam = state.key ? `&key=${encodeURIComponent(state.key)}` : '';
    const ticketParam = state.ticket ? `&ticket=${encodeURIComponent(state.ticket)}` : '';
    const previewUrl = `/api/shares/${state.token}/files/${file.id}/preview?inline=1${keyParam}${ticketParam}`;
    const mime = (file.mime || '').toLowerCase();
    const ext = (file.name.split('.').pop() || '').toLowerCase();

    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) {
      body.innerHTML = `<img src="${previewUrl}" alt="${Common.escapeAttr(file.name)}" style="max-width:100%; max-height:70vh; object-fit:contain; border-radius:var(--radius-sm);" />`;
    } else if (mime.startsWith('video/') || ['mp4', 'webm', 'mkv', 'mov'].includes(ext)) {
      body.innerHTML = `<video src="${previewUrl}" controls autoplay style="max-width:100%; max-height:70vh; width:100%; border-radius:var(--radius-sm);"></video>`;
    } else if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) {
      body.innerHTML = `<audio src="${previewUrl}" controls autoplay style="width:100%;"></audio>`;
    } else if (mime === 'application/pdf' || ext === 'pdf') {
      body.innerHTML = `<iframe src="${previewUrl}" style="width:100%; height:75vh; border:none; border-radius:var(--radius-sm);"></iframe>`;
    } else if (mime.startsWith('text/') || ['txt', 'md', 'json', 'js', 'py', 'html', 'css', 'csv', 'log', 'xml', 'yaml', 'yml'].includes(ext)) {
      try {
        const text = await fetch(previewUrl).then(r => r.text());
        body.innerHTML = `<pre class="mono" style="background:var(--bg-void); padding:1rem; border-radius:var(--radius-sm); max-height:70vh; width:100%; overflow:auto; font-size:12px; line-height:1.6; color:#a7f3d0; text-align:left;"><code>${Common.escapeHtml(text)}</code></pre>`;
        copyBtn.classList.remove('hidden');
        copyBtn.onclick = () => Common.copyText(text);
      } catch (e) {
        body.innerHTML = `<div class="mono" style="color:var(--accent-red);">Failed to load text preview: ${Common.escapeHtml(e.message)}</div>`;
      }
    } else {
      body.innerHTML = `
        <div style="text-align:center; padding:2rem;">
          <div style="font-size:36px; margin-bottom:0.5rem; color:var(--text-dim);">📦</div>
          <p style="color:var(--text-muted); margin-bottom:1rem;">Inline preview not available for this file type (${ext || 'binary'}).</p>
          <a href="${previewUrl}" class="btn btn-primary" download="${Common.escapeAttr(file.name)}">Download File</a>
        </div>
      `;
    }
  };

  function setupModals() {
    el('closePreviewBtn').onclick = () => {
      const body = el('previewBody');
      body.innerHTML = ''; // Stops video/audio immediately
      el('previewModal').classList.add('hidden');
    };

    el('previewModal').onclick = (e) => {
      if (e.target === el('previewModal')) {
        el('closePreviewBtn').click();
      }
    };
  }

  window.addEventListener('DOMContentLoaded', init);
})();
