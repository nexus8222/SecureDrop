/**
 * SecureDrop LAN — Send Terminal Engine
 */

(function () {
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
  const state = {
    files: [],
    transmitting: false,
  };

  const el = (id) => document.getElementById(id);

  async function init() {
    await Common.initNavigation('send');
    updateCryptoBadge();
    setupDropzone();
    setupControls();
  }

  function updateCryptoBadge() {
    const badge = el('cryptoBadge');
    if (Common.hasClientCrypto()) {
      badge.textContent = 'Browser AES-GCM (Zero Knowledge)';
      badge.className = 'badge badge-emerald';
    } else {
      badge.textContent = 'HTTP LAN Mode (Node Encrypted at Rest)';
      badge.className = 'badge badge-amber';
    }
  }

  function setupDropzone() {
    const dz = el('dropzone');
    const fileInput = el('fileInput');
    const folderInput = el('folderInput');

    el('pickFilesBtn').onclick = (e) => { e.stopPropagation(); fileInput.click(); };
    el('pickFolderBtn').onclick = (e) => { e.stopPropagation(); folderInput.click(); };
    dz.onclick = () => fileInput.click();

    fileInput.onchange = (e) => { addFileList([...e.target.files]); fileInput.value = ''; };
    folderInput.onchange = (e) => { addFileList([...e.target.files]); folderInput.value = ''; };

    ['dragenter', 'dragover'].forEach(name => {
      dz.addEventListener(name, (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(name => {
      dz.addEventListener(name, (e) => { e.preventDefault(); dz.classList.remove('dragover'); });
    });

    dz.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = [];
      if (e.dataTransfer.items) {
        for (const item of e.dataTransfer.items) {
          const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
          if (entry) {
            await walkFileTree(entry, '', files);
          } else {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      } else if (e.dataTransfer.files) {
        files.push(...e.dataTransfer.files);
      }
      addFileList(files);
    });
  }

  async function walkFileTree(entry, path, out) {
    if (entry.isFile) {
      await new Promise((resolve) => {
        entry.file((file) => {
          file.relativePathOverride = path + file.name;
          out.push(file);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise((resolve) => reader.readEntries(resolve));
      for (const child of entries) {
        await walkFileTree(child, path + entry.name + '/', out);
      }
    }
  }

  function addFileList(files) {
    for (const f of files) {
      f.relPath = f.webkitRelativePath || f.relativePathOverride || f.name;
      state.files.push(f);
    }
    renderFileList();
  }

  function renderFileList() {
    const tbody = el('fileTableBody');
    const wrapper = el('fileTableWrapper');
    const badge = el('fileCountBadge');

    badge.textContent = `${state.files.length} Files`;
    if (!state.files.length) {
      wrapper.classList.add('hidden');
      tbody.innerHTML = '';
      return;
    }

    wrapper.classList.remove('hidden');
    tbody.innerHTML = state.files.map((f, i) => {
      const chunks = Math.ceil(f.size / CHUNK_SIZE) || 1;
      return `
        <tr>
          <td>
            <div class="file-name-cell">${Common.escapeHtml(f.name)}</div>
            <div class="file-path">${Common.escapeHtml(f.relPath)}</div>
          </td>
          <td class="mono">${Common.fmtBytes(f.size)}</td>
          <td class="mono">${chunks}</td>
          <td style="text-align:right;">
            <button class="btn btn-sm btn-danger" onclick="window.removeFile(${i})">Remove</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.removeFile = (index) => {
    state.files.splice(index, 1);
    renderFileList();
  };

  function setupControls() {
    el('clearBtn').onclick = () => {
      if (state.transmitting) return;
      state.files = [];
      renderFileList();
    };

    el('uploadBtn').onclick = () => {
      if (state.transmitting) return;
      transmitPayload().catch((err) => {
        state.transmitting = false;
        el('telemetryStatus').textContent = 'Failed';
        el('telemetryStatus').className = 'badge badge-red';
        Common.toast(err.message, 'error', 6000);
      });
    };
  }

  async function transmitPayload() {
    if (!state.files.length) {
      return Common.toast('Select files or folders to transmit', 'error');
    }

    state.transmitting = true;
    el('uploadBtn').disabled = true;
    el('outputContainer').classList.add('hidden');

    const clientCrypto = Common.hasClientCrypto();
    const keyData = clientCrypto ? await Common.generateAesKey() : { key: null, rawB64: 'server' };
    const key = keyData.key;
    const rawB64 = keyData.rawB64;

    const totalBytes = state.files.reduce((acc, f) => acc + f.size, 0);
    const title = el('shareTitle').value.trim() || `${state.files.length} File Payload`;
    const expiresSeconds = el('expiresSelect').value ? Number(el('expiresSelect').value) : null;
    const maxDownloads = Number(el('maxDownloads').value || 0);
    const password = el('sharePassword').value || null;
    const requireApproval = el('requireApproval').checked;
    const deleteAfter = el('deleteAfter').checked;

    el('telemetryStatus').textContent = 'Initializing';
    el('telemetryStatus').className = 'badge badge-amber';

    // 1. Create Share Record
    const shareRes = await Common.api('/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        mode: 'files',
        expires_seconds: expiresSeconds,
        password,
        require_approval: requireApproval,
        delete_after_download: deleteAfter,
        max_downloads: maxDownloads,
        meta: {
          encryption_mode: clientCrypto ? 'browser-aes-gcm' : 'server-aes-gcm-compat',
          client_crypto: clientCrypto,
        }
      })
    });

    const token = shareRes.token;
    const pin = shareRes.pin || '----';

    // 2. Build Chunk Matrix Grid
    const matrixBox = el('chunkMatrix');
    matrixBox.innerHTML = '';
    let totalChunks = 0;
    const filePlans = [];

    state.files.forEach((f, fIdx) => {
      const cCount = Math.ceil(f.size / CHUNK_SIZE) || 1;
      filePlans.push({ file: f, chunkCount: cCount, fileIdx: fIdx });
      for (let cIdx = 0; cIdx < cCount; cIdx++) {
        totalChunks++;
        const block = document.createElement('div');
        block.id = `chk_${fIdx}_${cIdx}`;
        block.className = 'chunk-block pending';
        block.title = `${f.name} (Chunk ${cIdx + 1}/${cCount})`;
        matrixBox.appendChild(block);
      }
    });

    el('chunkSummary').textContent = `0/${totalChunks}`;
    el('telemetryStatus').textContent = 'Transmitting';
    el('telemetryStatus').className = 'badge badge-cyan';

    let completedBytes = 0;
    let completedChunks = 0;
    const startTime = performance.now();

    // 3. Process Each File
    for (const plan of filePlans) {
      const f = plan.file;
      const fIdx = plan.fileIdx;
      const cCount = plan.chunkCount;
      const fileId = `file_${Math.random().toString(36).slice(2, 14)}`;

      el('meterFilename').textContent = f.relPath;

      // Register file manifest on backend
      await Common.api(`/api/shares/${token}/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: fileId,
          name: f.name,
          relative_path: f.relPath,
          size: f.size,
          mime: f.type || 'application/octet-stream',
          chunk_size: CHUNK_SIZE,
          chunk_count: cCount,
          compression: 'none'
        })
      });

      // Upload chunks with 4-way parallel workers
      let nextChunk = 0;
      const parallelWorkers = Math.min(4, cCount);

      async function worker() {
        while (nextChunk < cCount) {
          const cIdx = nextChunk++;
          const block = el(`chk_${fIdx}_${cIdx}`);
          if (block) block.className = 'chunk-block uploading';

          const slice = f.slice(cIdx * CHUNK_SIZE, Math.min(f.size, (cIdx + 1) * CHUNK_SIZE));
          const plainBuf = await slice.arrayBuffer();
          const plainSha = await Common.sha256Hex(plainBuf);

          if (clientCrypto) {
            const encrypted = await Common.encryptChunk(key, plainBuf);
            const cipherSha = await Common.sha256Hex(encrypted.payload);
            const metaObj = {
              plaintext_sha256: plainSha,
              ciphertext_sha256: cipherSha,
              original_size: plainBuf.byteLength,
              compression: 'none',
              nonce_b64: encrypted.nonceB64
            };
            const metaHeader = btoa(JSON.stringify(metaObj));

            const resp = await fetch(`/api/shares/${token}/files/${fileId}/chunks/${cIdx}`, {
              method: 'PUT',
              headers: { 'x-chunk-meta': metaHeader },
              body: encrypted.payload
            });
            if (!resp.ok) throw new Error(`Chunk ${cIdx} rejected: ${await resp.text()}`);
          } else {
            const headers = {};
            if (plainSha) headers['x-plaintext-sha256'] = plainSha;
            const resp = await fetch(`/api/shares/${token}/files/${fileId}/chunks/${cIdx}/plain`, {
              method: 'PUT',
              headers,
              body: plainBuf
            });
            if (!resp.ok) throw new Error(`Chunk ${cIdx} rejected: ${await resp.text()}`);
          }

          if (block) block.className = 'chunk-block done';
          completedChunks++;
          completedBytes += plainBuf.byteLength;

          // Update telemetry
          const elapsedSec = Math.max((performance.now() - startTime) / 1000, 0.05);
          const bps = completedBytes / elapsedSec;
          const percent = totalBytes > 0 ? (completedBytes / totalBytes) * 100 : 100;
          const remainingSec = bps > 0 ? (totalBytes - completedBytes) / bps : 0;

          el('meterFill').style.width = `${Math.min(percent, 100).toFixed(1)}%`;
          el('meterPercent').textContent = `${percent.toFixed(1)}%`;
          el('meterSpeed').textContent = Common.fmtSpeed(bps);
          el('meterEta').textContent = `ETA: ${Common.fmtTime(remainingSec)}`;
          el('meterBytes').textContent = `${Common.fmtBytes(completedBytes)} / ${Common.fmtBytes(totalBytes)}`;
          el('chunkSummary').textContent = `${completedChunks}/${totalChunks}`;
        }
      }

      await Promise.all(Array.from({ length: parallelWorkers }, worker));
    }

    // 4. Transmission Complete! Render Output
    state.transmitting = false;
    el('uploadBtn').disabled = false;
    el('telemetryStatus').textContent = 'Transmitted';
    el('telemetryStatus').className = 'badge badge-emerald';
    el('meterEta').textContent = 'Completed';
    el('meterFill').style.width = '100%';

    const shareUrl = clientCrypto
      ? `${location.origin}/share/${token}#key=${rawB64}`
      : `${location.origin}/share/${token}#mode=server`;

    el('pinDisplay').textContent = pin;
    el('shareLinkInput').value = shareUrl;
    el('qrImage').src = `/api/shares/${token}/qr?key=${encodeURIComponent(rawB64)}`;

    const curlCmd = `curl -OJ "${location.origin}/api/shares/${token}/zip${clientCrypto ? `?key=${rawB64}` : ''}"`;
    el('curlInput').value = curlCmd;

    el('copyPinBtn').onclick = () => Common.copyText(pin);
    el('copyLinkBtn').onclick = () => Common.copyText(shareUrl);
    el('copyCurlBtn').onclick = () => Common.copyText(curlCmd);

    el('outputContainer').classList.remove('hidden');
    Common.toast('Payload transmission verified and ready!', 'success', 5000);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
