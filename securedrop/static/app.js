const $ = (id) => document.getElementById(id);
const state = {
  info: null,
  files: [],
  currentShare: null,
  currentKey: null,
  currentTicket: null,
  queue: [],
  ws: null,
  installPrompt: null,
  optimizer: { recommended_chunk_size: 4 * 1024 * 1024, recommended_parallel_streams: 4 },
  auth: {role:'guest', configured:false, is_admin:false},
  activeTab: 'send'
};

function hasClientCrypto(){
  return !!(window.crypto && crypto.subtle && window.isSecureContext);
}
function cryptoMode(){
  return hasClientCrypto() ? 'browser-aes-gcm' : 'server-aes-gcm-compat';
}
function randomId(prefix='id_'){
  if(window.crypto && crypto.randomUUID) return prefix + crypto.randomUUID().replaceAll('-', '');
  const bytes = new Uint8Array(16);
  if(window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for(let i=0;i<bytes.length;i++) bytes[i] = Math.floor(Math.random()*256);
  return prefix + [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
window.addEventListener('error', e => toast('UI error: ' + (e.message || 'unknown'), 8000));
window.addEventListener('unhandledrejection', e => toast('Action failed: ' + ((e.reason && e.reason.message) || e.reason || 'unknown'), 8000));

function toast(msg, timeout=3500){
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.classList.add('hidden'), timeout);
}

function fmtBytes(bytes){
  bytes = Number(bytes || 0);
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  while(bytes >= 1024 && i < units.length-1){ bytes/=1024; i++; }
  return `${bytes.toFixed(i===0?0:2)} ${units[i]}`;
}

function fmtTime(sec){
  sec = Math.max(0, Number(sec||0));
  if(!isFinite(sec)) return '--';
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
  return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
}

function b64urlFromBytes(bytes){
  let bin = '';
  const arr = new Uint8Array(bytes);
  for(let i=0;i<arr.length;i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function bytesFromB64url(s){
  s = (s || '').replace(/-/g,'+').replace(/_/g,'/');
  while(s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256Hex(buf){
  // On HTTP LAN origins, many mobile browsers disable crypto.subtle.
  // In server-encrypted compatibility mode the backend verifies hashes, so returning
  // null is safer than breaking the upload before the first chunk POST.
  if(!(window.crypto && crypto.subtle)) return null;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function generateAesKey(){
  const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256}, true, ['encrypt','decrypt']);
  const raw = await crypto.subtle.exportKey('raw', key);
  return {key, rawB64: b64urlFromBytes(raw)};
}
async function importAesKey(rawB64){
  const raw = bytesFromB64url(rawB64);
  return crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, false, ['encrypt','decrypt']);
}
async function encryptChunk(key, plainBuf){
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv:nonce}, key, plainBuf);
  const payload = new Uint8Array(nonce.length + cipher.byteLength);
  payload.set(nonce,0); payload.set(new Uint8Array(cipher),12);
  return {payload: payload.buffer, nonceB64: b64urlFromBytes(nonce)};
}
async function decryptChunk(key, payload){
  const arr = new Uint8Array(payload);
  const nonce = arr.slice(0,12);
  const cipher = arr.slice(12);
  return crypto.subtle.decrypt({name:'AES-GCM', iv:nonce}, key, cipher);
}
async function maybeCompress(buf, fileName){
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const compressExt = new Set(['txt','csv','json','xml','html','css','js','py','java','c','cpp','log','sql','md']);
  if(!compressExt.has(ext) || !('CompressionStream' in window)) return {buf, mode:'none'};
  try{
    const stream = new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = await new Response(stream).arrayBuffer();
    if(compressed.byteLength < buf.byteLength * 0.95) return {buf: compressed, mode:'gzip'};
  }catch(e){ console.warn('compression skipped', e); }
  return {buf, mode:'none'};
}

function parseChunkMeta(header){
  if(!header) return {};
  try{
    const bytes = bytesFromB64url(header);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  }catch(e){
    try{return JSON.parse(atob(header));}catch{return {};}
  }
}

async function maybeDecompress(buf, mode){
  if(!mode || mode === 'none') return buf;
  if(mode === 'gzip' && 'DecompressionStream' in window){
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  throw new Error(`This browser cannot decompress ${mode}. Try Chrome/Edge or create share without compression.`);
}

function loadLocalQueue(){
  try{ state.queue = JSON.parse(localStorage.getItem('securedrop_browser_queue') || '[]'); }catch{ state.queue = []; }
}
function saveLocalQueue(){
  try{ localStorage.setItem('securedrop_browser_queue', JSON.stringify(state.queue.slice(0,80))); }catch{}
}
function addQueue(item){
  item.id = item.id || 'q_' + Math.random().toString(36).slice(2);
  item.created = Date.now(); item.status = item.status || 'queued'; item.progress = item.progress || 0;
  state.queue.unshift(item); saveLocalQueue(); renderQueue(); return item;
}
function updateQueue(id, patch){
  const q = state.queue.find(x=>x.id===id); if(!q) return;
  Object.assign(q, patch); saveLocalQueue(); renderQueue();
}
function renderQueue(){
  const box = $('queueList');
  if(!state.queue.length){ box.innerHTML = '<div class="empty-state">No browser transfer yet.</div>'; return; }
  box.innerHTML = state.queue.map(q=>`
    <div class="queue-item">
      <div class="row" style="justify-content:space-between"><b>${escapeHtml(q.title||'Transfer')}</b><span class="badge ${q.status==='done'?'green':q.status==='failed'?'red':''}">${q.status}</span></div>
      <div class="progress"><div class="bar" style="width:${Math.min(100,q.progress||0)}%"></div></div>
      <div class="tiny muted">${(q.progress||0).toFixed(1)}% · ${q.speed?fmtBytes(q.speed)+'/s':''} ${q.eta? '· ETA '+fmtTime(q.eta):''}</div>
      <div class="tiny muted">${q.created ? new Date(q.created).toLocaleString() : ''}</div>
      <div class="tiny muted">${escapeHtml(q.detail||'')}</div>
    </div>`).join('');
}
function escapeHtml(s){ return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function api(path, opts={}){
  const res = await fetch(path, opts);
  if(!res.ok){
    let text = await res.text();
    try{ text = JSON.parse(text).detail || text; }catch{}
    throw new Error(text);
  }
  return res.json();
}

function isAdminTab(name){ return ['peers','queue','approvals','history','vault','settings'].includes(name); }
function setTab(name){
  if(isAdminTab(name) && !state.auth.is_admin){ toast('Admin login required. Guest sandbox only has Send and Receive.', 5000); name='send'; }
  state.activeTab = name;
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.id===`tab-${name}`));
  const titles = {send:['Send Files','Create encrypted shares from this device.'],receive:['Receive Files','Download/decrypt in browser or start backend pull.'],peers:['LAN Peers','Discover trusted devices on your network.'],queue:['Transfer Queue','Live progress for browser and backend jobs.'],approvals:['Approvals','Accept or reject incoming receive requests.'],history:['History','Local transfer audit log.'],vault:['Server Storage','View and delete stored server data.'],settings:['Settings','Device identity, clipboard, and diagnostics.']};
  $('pageTitle').textContent = titles[name]?.[0] || name;
  $('pageSubtitle').textContent = titles[name]?.[1] || '';
  if(name==='peers') refreshPeers();
  if(name==='history') refreshHistory();
  if(name==='vault') refreshVault();
  if(name==='approvals') refreshApprovals();
  if(name==='queue') refreshJobs();
}

async function init(){
  loadLocalQueue();
  document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
  setupAuthUi();
  await refreshAuth();
  try{ state.optimizer = await api('/api/optimizer'); }catch{}
  await refreshInfo();
  if(!hasClientCrypto()) {
    $('integrityDash').innerHTML = 'Compatibility mode active: this browser/origin does not expose Web Crypto on HTTP LAN IP. Files are encrypted at rest by the local Python node. For browser end-to-end encryption, use localhost or HTTPS.';
  }
  setupWebSocket();
  setupPwa();
  setupSendUi();
  setupReceiveUi();
  setupMiscUi();
  renderQueue();
  if(state.auth.is_admin){ refreshPeers(); refreshApprovals(); refreshJobs(); refreshStorage(); }
  setInterval(()=>{ if(state.auth.is_admin && state.activeTab === 'queue') refreshJobs(); }, 2500);
  setInterval(()=>{ if(state.auth.is_admin && state.activeTab === 'approvals') refreshApprovals(); }, 3000);
  const pathMatch = location.pathname.match(/^\/share\/([^\/]+)/);
  if(pathMatch){
    setTab('receive');
    $('receiveLink').value = location.href;
    loadShareFromInput();
  }
}

async function refreshAuth(){
  try{ state.auth = await api('/api/auth/status'); }
  catch(e){ state.auth = {role:'guest', configured:false, is_admin:false}; }
  applyAuthUi();
}
function applyAuthUi(){
  const admin = !!state.auth.is_admin;
  document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('hidden', !admin));
  $('roleBadge').textContent = admin ? 'Admin unlocked' : 'Guest sandbox';
  $('roleBadge').className = admin ? 'badge green' : 'badge orange';
  $('adminLoginBtn').classList.toggle('hidden', admin);
  $('adminLogoutBtn').classList.toggle('hidden', !admin);
  if(!admin && isAdminTab(state.activeTab)) setTab('send');
}
function setupAuthUi(){
  $('adminLoginBtn').onclick = ()=>openAuthModal();
  $('adminLogoutBtn').onclick = async()=>{ await api('/api/auth/logout',{method:'POST'}); await refreshAuth(); toast('Logged out. Guest sandbox active.'); };
  $('closeAuthModal').onclick = ()=>$('authModal').classList.add('hidden');
  $('adminSubmitBtn').onclick = submitAdminAuth;
  $('adminPasswordInput').addEventListener('keydown', e=>{ if(e.key==='Enter') submitAdminAuth(); });
}
function openAuthModal(){
  const setup = !state.auth.configured;
  $('authTitle').textContent = setup ? 'Create admin password' : 'Admin login';
  $('authHelp').textContent = setup ? 'First run: create an admin password. Guests will stay sandboxed to Send and Receive only.' : 'Admin unlocks approvals, LAN peers, queue, storage, history and settings.';
  $('adminPasswordInput').value = '';
  $('authStatusText').textContent = setup ? 'Minimum 6 characters.' : '';
  $('authModal').classList.remove('hidden');
  setTimeout(()=>$('adminPasswordInput').focus(), 80);
}
async function submitAdminAuth(){
  try{
    const password = $('adminPasswordInput').value;
    const endpoint = state.auth.configured ? '/api/auth/login' : '/api/auth/setup';
    await api(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});
    $('authModal').classList.add('hidden');
    await refreshAuth(); await refreshInfo();
    toast('Admin mode unlocked');
    refreshPeers(); refreshApprovals(); refreshJobs(); refreshStorage();
  }catch(e){ $('authStatusText').textContent = e.message; toast('Auth failed: '+e.message, 6000); }
}

async function refreshInfo(){
  state.info = await api('/api/info');
  $('nodeName').textContent = state.info.device_name;
  $('deviceNameInput').value = state.info.device_name;
  $('nodeUrls').innerHTML = state.info.web_urls.map(u=>`<div>${u}</div>`).join('') + `<div>TCP: ${state.info.tcp_addresses.join(', ')}</div>`;
  $('clientIp').textContent = 'Browser/client IP: ' + (state.info.browser_client_ip || 'local');
  $('deviceInfo').textContent = JSON.stringify(state.info,null,2);
}

function setupWebSocket(){
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws.onmessage = (event)=>{
    const msg = JSON.parse(event.data);
    if(msg.type === 'approval_requested'){
      if(state.auth.is_admin){
        toast(`Incoming approval request from ${msg.device_name}`);
        notify('SecureDrop approval', `${msg.device_name} wants to receive ${msg.share_title}`);
        refreshApprovals();
      }
    }
    if(msg.type === 'approval_decided'){
      toast(`Approval ${msg.status}`);
      $('approvalStatus').textContent = `Approval ${msg.status}. Loading share again...`;
      state.currentTicket = msg.ticket || state.currentTicket;
      setTimeout(loadShareFromInput, 800);
    }
    if(msg.type === 'peer_seen') refreshPeers();
    if(msg.type === 'job_update') refreshJobs();
    if(msg.type === 'download_complete') toast('Receiver completed a download.');
  };
  state.ws.onclose = ()=>setTimeout(setupWebSocket, 3000);
}

function setupPwa(){
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); state.installPrompt=e; $('installBtn').classList.remove('hidden'); });
  $('installBtn').onclick = async()=>{ if(state.installPrompt){ state.installPrompt.prompt(); state.installPrompt=null; }};
  $('notifyBtn').onclick = async()=>{ if('Notification' in window){ await Notification.requestPermission(); toast('Notifications enabled'); }};
}
function notify(title, body){
  if('Notification' in window && Notification.permission === 'granted') new Notification(title,{body});
}

function setupSendUi(){
  $('pickFiles').onclick = ()=>$('fileInput').click();
  $('pickFolder').onclick = ()=>$('folderInput').click();
  $('fileInput').onchange = (e)=>addFiles([...e.target.files]);
  $('folderInput').onchange = (e)=>addFiles([...e.target.files]);
  $('clearFilesBtn').onclick = ()=>{state.files=[]; renderSelectedFiles();};
  const dz = $('dropZone');
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev, e=>{e.preventDefault(); dz.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev, e=>{e.preventDefault(); dz.classList.remove('drag');}));
  dz.addEventListener('drop', async e=>{
    const files = [];
    if(e.dataTransfer.items){
      for(const item of e.dataTransfer.items){
        const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
        if(entry) await walkEntry(entry, '', files); else { const f = item.getAsFile(); if(f) files.push(f); }
      }
    } else files.push(...e.dataTransfer.files);
    addFiles(files);
  });
  $('createShareBtn').onclick = () => createAndUploadShare().catch(e => toast('Send failed: ' + e.message, 8000));
}

async function walkEntry(entry, path, out){
  if(entry.isFile){
    await new Promise(resolve=>entry.file(file=>{ file.relativePathOverride = path + file.name; out.push(file); resolve(); }));
  } else if(entry.isDirectory){
    const reader = entry.createReader();
    const entries = await new Promise(resolve=>reader.readEntries(resolve));
    for(const ent of entries) await walkEntry(ent, path + entry.name + '/', out);
  }
}
function addFiles(files){
  for(const f of files){
    f.secureRelativePath = f.webkitRelativePath || f.relativePathOverride || f.name;
    state.files.push(f);
  }
  renderSelectedFiles();
}
function renderSelectedFiles(){
  const box = $('selectedFiles');
  if(!state.files.length){ box.innerHTML=''; return; }
  const total = state.files.reduce((a,f)=>a+f.size,0);
  box.innerHTML = `<div class="tiny muted">${state.files.length} item(s), ${fmtBytes(total)}</div>` + state.files.slice(0,80).map(f=>`
    <div class="file-item"><div><div class="file-title">${escapeHtml(f.secureRelativePath)}</div><div class="file-meta">${fmtBytes(f.size)} · ${escapeHtml(f.type||'file')}</div></div></div>
  `).join('') + (state.files.length>80?`<div class="tiny muted">+${state.files.length-80} more</div>`:'');
}

async function createAndUploadShare(){
  if(!state.files.length){ toast('Choose files first'); return; }
  const clientCrypto = hasClientCrypto();
  const keyInfo = clientCrypto ? await generateAesKey() : {key:null, rawB64:'server'};
  const key = keyInfo.key;
  const rawB64 = keyInfo.rawB64;
  const title = $('shareTitle').value.trim() || `${state.files.length} file share`;
  const share = await api('/api/shares', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
    title,
    mode:'files',
    expires_seconds: $('expiresSelect').value ? Number($('expiresSelect').value) : null,
    password: $('sharePassword').value || null,
    require_approval: $('requireApproval').checked,
    delete_after_download: $('deleteAfter').checked,
    max_downloads: Number($('maxDownloads').value || 0),
    meta:{
      created_by: state.info?.device_name,
      browser_encrypted: clientCrypto,
      server_encrypted: !clientCrypto,
      encryption_mode: cryptoMode(),
      note: clientCrypto ? 'Browser Web Crypto AES-GCM' : 'HTTP LAN compatibility mode: Python node encrypts chunks at rest'
    }
  })});
  const token = share.token;
  state.currentShare = token; state.currentKey = rawB64;
  const base = `${location.origin}/share/${token}`;
  const link = clientCrypto ? `${base}#key=${rawB64}` : `${base}#mode=server`;
  $('shareOutput').innerHTML = `
    <div class="empty-state">
      Preparing share <b>${escapeHtml(token)}</b>... chunks are still uploading.
      The share link and QR will appear only after every chunk is stored.
    </div>`;
  let totalBytes = state.files.reduce((a,f)=>a+f.size,0), sentPlain = 0;
  const q = addQueue({title:`Upload ${title}`, status:'running', detail:'Registering files'});
  const start = performance.now();
  const chunkSize = Number(state.optimizer.recommended_chunk_size || (4*1024*1024));
  for(const file of state.files){
    const fileId = randomId('file_');
    const chunkCount = Math.ceil(file.size / chunkSize) || 1;
    await api(`/api/shares/${token}/files`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
      id:fileId, name:file.name, relative_path:file.secureRelativePath, size:file.size, mime:file.type, chunk_size:chunkSize, chunk_count:chunkCount, compression:'auto'
    })});
    const status = await api(`/api/shares/${token}/files/${fileId}/status`);
    const uploaded = new Set(status.uploaded.map(c=>c.chunk_index));
    const parallel = Math.min(4, Number(state.optimizer.recommended_parallel_streams || 4));
    let next = 0;
    async function worker(){
      while(next < chunkCount){
        const idx = next++;
        if(uploaded.has(idx)){ sentPlain += Math.min(chunkSize, file.size - idx*chunkSize); continue; }
        const slice = file.slice(idx*chunkSize, Math.min(file.size, (idx+1)*chunkSize));
        const plainBuf = await slice.arrayBuffer();
        const plainSha = await sha256Hex(plainBuf);
        if(clientCrypto){
          const compressed = await maybeCompress(plainBuf, file.name);
          const enc = await encryptChunk(key, compressed.buf);
          const cipherSha = await sha256Hex(enc.payload);
          const meta = {
            plaintext_sha256: plainSha,
            ciphertext_sha256: cipherSha,
            original_size: plainBuf.byteLength,
            compressed_size: compressed.buf.byteLength,
            compression: compressed.mode,
            nonce_b64: enc.nonceB64
          };
          const metaHeader = btoa(JSON.stringify(meta));
          await fetch(`/api/shares/${token}/files/${fileId}/chunks/${idx}`, {method:'PUT', headers:{'x-chunk-meta':metaHeader}, body:enc.payload}).then(async r=>{ if(!r.ok) throw new Error(await r.text() || `Chunk ${idx} failed`); });
        } else {
          const headers = {};
          if(plainSha) headers['x-plaintext-sha256'] = plainSha;
          await fetch(`/api/shares/${token}/files/${fileId}/chunks/${idx}/plain`, {method:'PUT', headers, body:plainBuf}).then(async r=>{ if(!r.ok) throw new Error(await r.text() || `Chunk ${idx} failed`); });
        }
        sentPlain += plainBuf.byteLength;
        const elapsed = Math.max((performance.now()-start)/1000, .1), speed = sentPlain/elapsed, eta=(totalBytes-sentPlain)/speed;
        updateQueue(q.id, {progress:sentPlain/totalBytes*100, speed, eta, detail:`${file.secureRelativePath} chunk ${idx+1}/${chunkCount}`});
      }
    }
    await Promise.all(Array.from({length:parallel}, worker));
  }
  updateQueue(q.id, {status:'done', progress:100, detail:'Upload complete. Share link is ready.'});
  renderShareOutput(token, link, rawB64, clientCrypto);
  toast('Encrypted share uploaded. Share link is ready now.');
  refreshIntegrity(token);
}

function renderShareOutput(token, link, key, clientCrypto=true){
  const modeBadge = clientCrypto ? '<span class="badge green">Browser E2E encryption</span>' : '<span class="badge orange">HTTP compatibility mode</span>';
  $('shareOutput').innerHTML = `
    <div>${modeBadge}</div>
    <div class="share-link mono">${escapeHtml(link)}</div>
    <div class="download-actions">
      <button class="primary" onclick="copyText('${escapeAttr(link)}')">Copy secure link</button>
      <button class="ghost" onclick="copyText('${escapeAttr(token)}')">Copy token</button>
      <button class="ghost" onclick="copyText('${escapeAttr(key)}')">Copy key</button>
    </div>
    <img class="qr" src="/api/shares/${token}/qr?key=${encodeURIComponent(key)}" alt="Share QR" />
    <p class="tiny muted">${clientCrypto ? 'The key is after #key= in the URL fragment. Browsers do not send URL fragments to the server.' : 'Compatibility mode is used because this page is opened on an HTTP LAN IP where Web Crypto is unavailable. Chunks are encrypted at rest by the Python node; use localhost/HTTPS for browser end-to-end encryption.'}</p>
  `;
}
function escapeAttr(s){return String(s).replace(/'/g,'&#39;').replace(/"/g,'&quot;');}
window.copyText = async (text)=>{ await navigator.clipboard.writeText(text); toast('Copied'); };

async function refreshIntegrity(token){
  try{
    const data = await api(`/api/integrity/${token}`);
    let total=0, ok=0;
    for(const f of data.files){ for(const c of f.chunks){ total++; if(c.ciphertext_ok) ok++; } }
    $('integrityDash').innerHTML = `Share ${token}<br>Encrypted chunks verified: <b>${ok}/${total}</b><br>Corrupted chunks: <b>${data.corrupted_chunks}</b>`;
  }catch(e){ $('integrityDash').textContent = e.message; }
}

function setupReceiveUi(){
  $('pasteLinkBtn').onclick = async()=>{ $('receiveLink').value = await navigator.clipboard.readText(); };
  $('loadShareBtn').onclick = loadShareFromInput;
  $('unlockShareBtn').onclick = unlockCurrentShare;
  $('startPullBtn').onclick = startPull;
}
function parseShareInput(){
  const raw = $('receiveLink').value.trim();
  if(!raw) throw new Error('Paste share link first');
  const url = new URL(raw, location.origin);
  const token = (url.pathname.match(/\/share\/([^\/]+)/)||[])[1] || $('pullToken').value.trim();
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  const key = hashParams.get('key') || '';
  const mode = hashParams.get('mode') || (key ? 'browser' : 'server');
  const baseUrl = `${url.protocol}//${url.host}`;
  if(!token) throw new Error('No token found in link');
  return {baseUrl, token, key, mode};
}
async function loadShareFromInput(){
  try{
    const p = parseShareInput();
    state.receive = p;
    state.currentKey = p.key;
    $('pullBaseUrl').value = p.baseUrl;
    $('pullToken').value = p.token;
    $('pullKey').value = p.key;
    const suffix = state.currentTicket ? `?ticket=${encodeURIComponent(state.currentTicket)}` : '';
    const meta = await fetch(`${p.baseUrl}/api/shares/${p.token}${suffix}`).then(r=>r.json());
    if(meta.locked){
      $('receiveLocked').classList.remove('hidden');
      $('shareDetails').innerHTML = `<div class="empty-state">Share is locked. Password: ${meta.requires_password?'yes':'no'}, approval: ${meta.requires_approval?'yes':'no'}</div>`;
      return;
    }
    $('receiveLocked').classList.add('hidden');
    renderShareDetails(meta, p);
  }catch(e){ toast(e.message, 6000); }
}
async function unlockCurrentShare(){
  try{
    const p = state.receive || parseShareInput();
    const body = {device_id: state.info?.device_id || 'browser', device_name: state.info?.device_name || navigator.userAgent.slice(0,30), password:$('receivePassword').value || null};
    const res = await fetch(`${p.baseUrl}/api/shares/${p.token}/unlock`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
    if(!res.ok) throw new Error(await res.text());
    const data = await res.json();
    state.currentTicket = data.ticket;
    if(data.pending_approval){ $('approvalStatus').textContent = 'Approval requested. Keep this page open.'; return; }
    $('approvalStatus').textContent = 'Access granted.';
    loadShareFromInput();
  }catch(e){ toast('Unlock failed: '+e.message, 6000); }
}
function shareReady(meta){
  return (meta.files || []).length > 0 && (meta.files || []).every(f => Number(f.uploaded_chunks || 0) >= Number(f.chunk_count || 0));
}
function notReadyText(meta){
  const pending = (meta.files || []).reduce((a,f)=> a + Math.max(0, Number(f.chunk_count||0)-Number(f.uploaded_chunks||0)), 0);
  return `Sender is still uploading. Missing chunks: ${pending}. Keep this page open and click Reload share in a few seconds.`;
}

function renderShareDetails(meta, p){
  if(meta.mode === 'clipboard'){
    $('shareDetails').innerHTML = `<div class="card"><h4>${escapeHtml(meta.title)}</h4><p class="muted">Clipboard share metadata received. Use the secure link flow for encrypted file/text payloads.</p></div>`;
    return;
  }
  const total = (meta.files||[]).reduce((a,f)=>a+Number(f.size||0),0);
  const ready = shareReady(meta);
  $('shareDetails').innerHTML = `
    <div class="card">
      <h4>${escapeHtml(meta.title)}</h4>
      <div class="tiny muted">${meta.files.length} files · ${fmtBytes(total)} · expires ${meta.expires_at ? new Date(meta.expires_at*1000).toLocaleString() : 'never'}</div>
      <div class="tiny muted">Mode: ${escapeHtml((meta.meta && meta.meta.encryption_mode) || p.mode || 'browser')}</div>
      ${ready ? '<div class="badge green">Ready to download</div>' : `<div class="badge orange">Uploading</div><p class="tiny muted">${escapeHtml(notReadyText(meta))}</p>`}
      <div class="download-actions">
        <button class="primary" id="downloadAllBtn" ${ready?'':'disabled'}>Download / save all</button>
        <button class="ghost" id="chooseDirBtn">Pick output folder</button>
        <button class="ghost" id="reloadShareBtn">Reload share</button>
      </div>
    </div>
    <div class="file-list">${meta.files.map(f=>`
      <div class="file-item">
        <div><div class="file-title">${escapeHtml(f.relative_path)}</div><div class="file-meta">${fmtBytes(f.size)} · chunks ${f.uploaded_chunks}/${f.chunk_count}</div></div>
        <div class="download-actions"><button class="ghost" data-preview="${f.id}" ${ready?'':'disabled'}>Preview</button><button class="primary" data-download="${f.id}" ${ready?'':'disabled'}>Download</button></div>
      </div>`).join('')}</div>`;
  $('downloadAllBtn').onclick = ()=> ready ? downloadAll(meta,p) : toast(notReadyText(meta), 6000);
  $('reloadShareBtn').onclick = loadShareFromInput;
  $('chooseDirBtn').onclick = async()=>{ if('showDirectoryPicker' in window){ state.outDir = await window.showDirectoryPicker(); toast('Output folder selected'); } else toast('Your browser does not support folder writing. Use Chrome/Edge.'); };
  document.querySelectorAll('[data-download]').forEach(btn=>btn.onclick=()=> ready ? downloadOne(meta, p, meta.files.find(f=>f.id===btn.dataset.download)) : toast(notReadyText(meta), 6000));
  document.querySelectorAll('[data-preview]').forEach(btn=>btn.onclick=()=> ready ? previewOne(meta, p, meta.files.find(f=>f.id===btn.dataset.preview)) : toast(notReadyText(meta), 6000));
}
async function downloadAll(meta,p){
  for(const f of meta.files) await downloadOne(meta,p,f,true);
  await fetch(`${p.baseUrl}/api/shares/${p.token}/download-complete?ticket=${encodeURIComponent(state.currentTicket||'')}`, {method:'POST'}).catch(()=>{});
  toast('Download completed');
}
async function getWritableForFile(relPath){
  if(state.outDir && 'showDirectoryPicker' in window){
    const parts = relPath.split('/').filter(Boolean);
    let dir = state.outDir;
    for(let i=0;i<parts.length-1;i++) dir = await dir.getDirectoryHandle(parts[i], {create:true});
    const handle = await dir.getFileHandle(parts[parts.length-1], {create:true});
    return handle.createWritable();
  }
  return null;
}
async function downloadOne(meta,p,file,silent=false){
  const serverMode = (meta.meta && meta.meta.server_encrypted) || p.mode === 'server';
  if(!serverMode && !p.key) throw new Error('Missing #key in link');
  if(!serverMode && !hasClientCrypto()) throw new Error('This browser cannot decrypt browser-encrypted shares on HTTP LAN IP. Create the share from the LAN URL too, or use HTTPS/localhost.');
  const key = serverMode ? null : await importAesKey(p.key);
  const q = addQueue({title:`Download ${file.relative_path}`, status:'running'});
  const start = performance.now(); let got=0;
  const writable = await getWritableForFile(file.relative_path);
  const parts = writable ? null : [];
  for(let i=0;i<file.chunk_count;i++){
    const url = serverMode
      ? `${p.baseUrl}/api/shares/${p.token}/files/${file.id}/chunks/${i}/plain?ticket=${encodeURIComponent(state.currentTicket||'')}`
      : `${p.baseUrl}/api/shares/${p.token}/files/${file.id}/chunks/${i}?ticket=${encodeURIComponent(state.currentTicket||'')}`;
    const resp = await fetch(url);
    if(!resp.ok) throw new Error(await resp.text() || `chunk ${i} failed`);
    const chunkMeta = parseChunkMeta(resp.headers.get('x-chunk-meta'));
    const payload = await resp.arrayBuffer();
    const plain = serverMode ? payload : await maybeDecompress(await decryptChunk(key, payload), chunkMeta.compression || 'none');
    const digest = await sha256Hex(plain);
    if(digest && chunkMeta.plaintext_sha256 && digest !== chunkMeta.plaintext_sha256) throw new Error(`Integrity check failed for chunk ${i}`);
    got += plain.byteLength;
    if(writable) await writable.write(new Uint8Array(plain)); else parts.push(plain);
    const elapsed = Math.max((performance.now()-start)/1000,.1), speed=got/elapsed, eta=(file.size-got)/speed;
    updateQueue(q.id,{progress:got/file.size*100,speed,eta,detail:`chunk ${i+1}/${file.chunk_count}`});
  }
  if(writable){ await writable.close(); }
  else{
    if(file.size > 1024*1024*1024) toast('Large Blob fallback may fail. Use Chrome/Edge folder picker for huge files.', 8000);
    const blob = new Blob(parts, {type:file.mime||'application/octet-stream'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
  }
  updateQueue(q.id,{status:'done',progress:100,detail:'Verified and saved'});
  if(!silent) await fetch(`${p.baseUrl}/api/shares/${p.token}/download-complete?ticket=${encodeURIComponent(state.currentTicket||'')}`, {method:'POST'}).catch(()=>{});
}
async function previewOne(meta,p,file){
  if(file.size > 50*1024*1024){ toast('Preview limited to files under 50MB'); return; }
  const serverMode = (meta.meta && meta.meta.server_encrypted) || p.mode === 'server';
  if(!serverMode && !hasClientCrypto()) throw new Error('This browser cannot preview browser-encrypted shares on HTTP LAN IP.');
  const key = serverMode ? null : await importAesKey(p.key);
  const parts=[];
  for(let i=0;i<file.chunk_count;i++){
    const url = serverMode
      ? `${p.baseUrl}/api/shares/${p.token}/files/${file.id}/chunks/${i}/plain?ticket=${encodeURIComponent(state.currentTicket||'')}`
      : `${p.baseUrl}/api/shares/${p.token}/files/${file.id}/chunks/${i}?ticket=${encodeURIComponent(state.currentTicket||'')}`;
    const resp = await fetch(url);
    const chunkMeta = parseChunkMeta(resp.headers.get('x-chunk-meta'));
    const payload = await resp.arrayBuffer();
    parts.push(serverMode ? payload : await maybeDecompress(await decryptChunk(key, payload), chunkMeta.compression || 'none'));
  }
  const blob = new Blob(parts,{type:file.mime||'application/octet-stream'});
  const url = URL.createObjectURL(blob);
  $('previewTitle').textContent = file.relative_path;
  const body = $('previewBody');
  if((file.mime||'').startsWith('image/')) body.innerHTML = `<img src="${url}">`;
  else if((file.mime||'').startsWith('video/')) body.innerHTML = `<video src="${url}" controls></video>`;
  else if(file.mime === 'application/pdf') body.innerHTML = `<iframe src="${url}"></iframe>`;
  else if((file.mime||'').startsWith('text/') || /\.(txt|md|json|js|py|css|html|log)$/i.test(file.name)) body.innerHTML = `<pre>${escapeHtml(await blob.text())}</pre>`;
  else body.innerHTML = `<div class="empty-state">No preview for this file type. <a href="${url}" download="${escapeHtml(file.name)}">Download</a></div>`;
  $('previewModal').classList.remove('hidden');
}

async function startPull(){
  try{
    const res = await api('/api/pulls/start',{method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
      base_url:$('pullBaseUrl').value.trim(), token:$('pullToken').value.trim(), key_b64:$('pullKey').value.trim(), password:$('pullPassword').value || null,
      parallelism:4, use_tcp:false
    })});
    $('pullStatus').textContent = 'Started job ' + res.job_id;
    setTab('queue');
  }catch(e){ toast(e.message, 6000); }
}

async function refreshPeers(){
  if(!state.auth.is_admin) return;
  try{
    const data = await api('/api/discovery/peers');
    const box = $('peersList');
    if(!data.peers.length){ box.innerHTML = '<div class="empty-state">No peers found. Run SecureDrop on the other device, use same WiFi, and allow UDP 45678.</div>'; return; }
    box.innerHTML = data.peers.map(p=>`
      <div class="card">
        <h4>${escapeHtml(p.name)} ${p.trusted?'<span class="badge green">trusted</span>':''} ${p.blocked?'<span class="badge red">blocked</span>':''}</h4>
        <div class="tiny muted">${escapeHtml(p.device_id)}</div>
        <div class="tiny">Web: ${p.urls.map(u=>`<a href="${u}" target="_blank">${u}</a>`).join('<br>')}</div>
        <div class="tiny muted">TCP: ${p.tcp_addresses.join(', ')}</div>
        <div class="tiny muted">Last seen: ${new Date(p.last_seen*1000).toLocaleTimeString()}</div>
        <div class="card-actions">
          <button class="ghost" onclick="trustPeer('${escapeAttr(p.device_id)}','${escapeAttr(p.name)}',true,false)">Trust</button>
          <button class="ghost" onclick="trustPeer('${escapeAttr(p.device_id)}','${escapeAttr(p.name)}',false,true)">Block</button>
          <button class="primary" onclick="usePeer('${escapeAttr(p.urls[0]||'')}')">Use for receive</button>
        </div>
      </div>`).join('');
  }catch(e){ console.warn(e); }
}
window.trustPeer = async(device_id,name,trusted,blocked)=>{ await api('/api/trust',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({device_id,name,trusted,blocked})}); refreshPeers(); };
window.usePeer = (url)=>{ setTab('receive'); $('pullBaseUrl').value=url; toast('Peer URL added to background pull form'); };

async function refreshApprovals(){
  if(!state.auth.is_admin) return;
  try{
    const history = $('approvalHistoryToggle') && $('approvalHistoryToggle').checked;
    const data = await api('/api/approvals' + (history ? '?history=true' : ''));
    const box = $('approvalList');
    if(!data.approvals.length){ box.innerHTML='<div class="empty-state">No approval requests.</div>'; return; }
    box.innerHTML = data.approvals.map(a=>`
      <div class="card">
        <h4>${escapeHtml(a.device_name)} <span class="badge ${a.status==='accepted'?'green':a.status==='rejected'?'red':'orange'}">${a.status}</span></h4>
        <div class="tiny muted">Share: ${escapeHtml(a.share_token)} · IP: ${escapeHtml(a.requester_ip)}</div>
        ${a.status === 'pending' ? `<div class="card-actions">
          <button class="primary" onclick="decideApproval('${a.id}','accept')">Accept</button>
          <button class="ghost" onclick="decideApproval('${a.id}','reject')">Reject</button>
        </div>` : `<div class="tiny muted">Decision: ${a.status} · ${a.decided_at ? new Date(a.decided_at*1000).toLocaleString() : ''}</div>`}
      </div>`).join('');
  }catch(e){ console.warn(e); }
}
window.decideApproval = async(id,decision)=>{ await api(`/api/approvals/${id}/${decision}`,{method:'POST'}); refreshApprovals(); };

async function refreshHistory(){
  if(!state.auth.is_admin) return;
  const data = await api('/api/history');
  $('historyList').innerHTML = data.history.length ? data.history.map(h=>`
    <div class="history-row"><div>${new Date(h.created_at*1000).toLocaleString()}</div><div><b>${escapeHtml(h.title||h.direction)}</b><div class="tiny muted">${escapeHtml(h.detail||'')}</div></div><div>${escapeHtml(h.status)}</div><div>${h.size?fmtBytes(h.size):''}</div></div>
  `).join('') : '<div class="empty-state">No history yet.</div>';
}
async function refreshVault(){
  return refreshStorage();
}
async function refreshStorage(){
  if(!state.auth.is_admin) return;
  try{
    const data = await api('/api/storage/overview');
    $('storageSummary').innerHTML = `
      <div class="card"><h4>Total encrypted chunks</h4><div>${fmtBytes(data.encrypted_chunk_bytes)}</div><div class="tiny muted">${escapeHtml(data.storage_dir)}</div></div>
      <div class="card"><h4>Shares</h4><div>${data.share_count}</div><div class="tiny muted">Temporary files: ${fmtBytes(data.tmp_bytes)}</div></div>`;
    if(!data.shares.length){ $('vaultStatus').innerHTML='<div class="empty-state">No stored shares yet.</div>'; return; }
    $('vaultStatus').innerHTML = data.shares.map(s=>`
      <div class="card">
        <h4>${escapeHtml(s.title||s.token)} <span class="badge ${s.status==='open'?'green':'orange'}">${escapeHtml(s.status)}</span></h4>
        <div class="tiny muted">Token: ${escapeHtml(s.token)}</div>
        <div class="tiny muted">Created: ${new Date(s.created_at*1000).toLocaleString()}</div>
        <div class="tiny">Files: ${s.file_count} · Original: ${fmtBytes(s.total_size)} · Stored: ${fmtBytes(s.stored_size)} · Chunks: ${s.chunk_count}</div>
        <div class="card-actions"><button class="ghost danger" onclick="deleteStoredShare('${escapeAttr(s.token)}')">Delete this share</button></div>
      </div>`).join('');
  }catch(e){ $('vaultStatus').innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; }
}
window.deleteStoredShare = async(token)=>{
  if(!confirm(`Delete stored data for share ${token}?`)) return;
  await api(`/api/storage/shares/${token}`, {method:'DELETE'});
  toast('Share data deleted'); refreshStorage();
};

window.deleteJob = async(job_id)=>{ await api(`/api/jobs/${job_id}`, {method:'DELETE'}); refreshJobs(); };
async function refreshJobs(){
  if(!state.auth.is_admin) return;
  const data = await api('/api/jobs');
  const box = $('jobsList');
  if(!data.jobs.length){ box.innerHTML='<div class="empty-state">No backend jobs.</div>'; return; }
  box.innerHTML = data.jobs.map(j=>`
    <div class="queue-item"><div class="row" style="justify-content:space-between"><b>${escapeHtml(j.title)}</b><span class="badge ${j.status==='done'?'green':j.status==='failed'?'red':'orange'}">${j.status}</span></div><div class="progress"><div class="bar" style="width:${Math.min(100,j.progress||0)}%"></div></div><div class="tiny muted">${Number(j.progress||0).toFixed(1)}% · ${fmtBytes(j.speed_bps||0)}/s · ETA ${fmtTime(j.eta_seconds||0)}</div><div class="tiny muted">${escapeHtml(j.detail||'')}</div><div class="card-actions"><button class="ghost danger" onclick="deleteJob('${escapeAttr(j.id)}')">Remove</button></div></div>
  `).join('');
}

function setupMiscUi(){
  $('approvalHistoryToggle').onchange = refreshApprovals;
  $('clearLocalQueueBtn').onclick = ()=>{ state.queue=[]; saveLocalQueue(); renderQueue(); toast('Browser queue cleared'); };
  $('refreshJobsBtn').onclick = refreshJobs;
  $('clearJobsBtn').onclick = async()=>{ if(confirm('Clear all backend jobs?')){ await api('/api/jobs',{method:'DELETE'}); refreshJobs(); }};
  $('refreshStorageBtn').onclick = refreshStorage;
  $('deleteAllStorageBtn').onclick = async()=>{ if(confirm('Delete ALL stored shares/chunks/history references on this node?')){ await api('/api/storage/all',{method:'DELETE'}); refreshStorage(); toast('All stored data deleted'); }};
  $('probeBtn').onclick = async()=>{ await api('/api/discovery/probe',{method:'POST'}); toast('Discovery probe sent'); setTimeout(refreshPeers,1000); };
  $('saveNameBtn').onclick = async()=>{ await api('/api/settings/device-name',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('deviceNameInput').value})}); await refreshInfo(); toast('Device name saved'); };
  $('shareClipboardBtn').onclick = async()=>{
    const text = $('clipboardText').value;
    if(!text.trim()) return toast('Enter text first');
    const {key, rawB64} = await generateAesKey();
    const file = new File([text], 'clipboard.txt', {type:'text/plain'});
    state.files = [file]; file.secureRelativePath='clipboard.txt'; $('shareTitle').value='Clipboard text';
    setTab('send'); toast('Clipboard loaded into send form. Click Create & Upload.');
  };
  $('closePreview').onclick = ()=>$('previewModal').classList.add('hidden');
}

init().catch(e=>{ console.error(e); toast(e.message, 8000); });
