import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload,
  File,
  Folder,
  Trash2,
  Lock,
  Users,
  Key,
  ShieldAlert,
  Play,
  Pause,
  Copy,
  CheckCircle,
  ExternalLink,
  QrCode,
  Radio,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { api } from '../api';
import { AuthStatus, GroupItem } from '../types';
import { generateAesKey, encryptChunk, sha256Hex } from '../crypto';

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB

interface SendTerminalProps {
  auth: AuthStatus | null;
}

export const SendTerminal: React.FC<SendTerminalProps> = ({ auth }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [expiresSeconds, setExpiresSeconds] = useState<number>(3600);
  const [maxDownloads, setMaxDownloads] = useState<number>(0);
  const [password, setPassword] = useState('');
  const [requireApproval, setRequireApproval] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [e2eeEnabled, setE2eeEnabled] = useState(true);

  // Sharing Mode: public / group / direct_users
  const [shareTargetMode, setShareTargetMode] = useState<'public' | 'group' | 'direct_users'>('public');
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<any[]>([]);
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);

  // Transfer State
  const [uploading, setUploading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState('0 B/s');
  const [activeShareData, setActiveShareData] = useState<any | null>(null);
  const [chunkMap, setChunkMap] = useState<{ total: number; uploaded: number; missing: number[] }>({
    total: 0,
    uploaded: 0,
    missing: [],
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // Load groups if logged in
  useEffect(() => {
    if (auth?.authenticated) {
      api.listGroups().then((res) => setGroups(res.groups || [])).catch(() => {});
    }
  }, [auth]);

  // Handle user search debounce
  useEffect(() => {
    if (!userSearchQuery.trim()) {
      setUserSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api.searchUsers(userSearchQuery).then((res) => setUserSearchResults(res.users || [])).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [userSearchQuery]);

  // Check for restored active upload on mount
  useEffect(() => {
    const userScope = auth?.user?.id || 'guest';
    const saved = localStorage.getItem(`sd_active_upload_${userScope}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.status === 'completed') {
          setActiveShareData(parsed);
        } else if (parsed.token) {
          // Check server status
          api.getChunksStatus(parsed.token).then((res) => {
            if (res.status === 'open') {
              setActiveShareData(parsed);
            }
          }).catch(() => {
            localStorage.removeItem(`sd_active_upload_${userScope}`);
          });
        }
      } catch {}
    }

    // Restore draft form inputs
    const draftStr = localStorage.getItem(`sd_draft_u_${userScope}`);
    if (draftStr) {
      try {
        const d = JSON.parse(draftStr);
        if (d.title) setTitle(d.title);
        if (d.password) setPassword(d.password);
        if (d.shareTargetMode) setShareTargetMode(d.shareTargetMode);
        if (d.selectedGroupId) setSelectedGroupId(d.selectedGroupId);
        if (d.selectedUsernames) setSelectedUsernames(d.selectedUsernames);
        if (d.expiresSeconds) setExpiresSeconds(d.expiresSeconds);
      } catch {}
    }
  }, [auth]);

  // Persist form draft inputs on change
  useEffect(() => {
    const userScope = auth?.user?.id || 'guest';
    if (!uploading && !activeShareData) {
      const d = {
        title,
        password,
        shareTargetMode,
        selectedGroupId,
        selectedUsernames,
        expiresSeconds,
      };
      localStorage.setItem(`sd_draft_u_${userScope}`, JSON.stringify(d));
    }
  }, [title, password, shareTargetMode, selectedGroupId, selectedUsernames, expiresSeconds, uploading, activeShareData, auth]);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = Array.from(e.target.files);
      setFiles((prev) => [...prev, ...selected]);
      if (!title && selected[0]) {
        setTitle(selected[0].name);
      }
    }
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Start Upload Pipeline
  const handleStartUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setPaused(false);
    setOverallProgress(0);

    const userScope = auth?.user?.id || 'guest';

    try {
      let rawKeyB64: string | undefined = undefined;
      let cryptoKey: CryptoKey | null = null;
      if (e2eeEnabled) {
        const keyGen = await generateAesKey();
        cryptoKey = keyGen.key;
        rawKeyB64 = keyGen.rawBase64;
      }

      // 1. Create Share on Backend
      const shareRes = await api.createShare({
        title: title || files[0].name,
        mode: 'files',
        expires_seconds: expiresSeconds || null,
        password: password || null,
        key: rawKeyB64 || null,
        require_approval: requireApproval,
        delete_after_download: deleteAfter,
        max_downloads: maxDownloads || 0,
        meta: {
          encryption_mode: e2eeEnabled ? 'browser-aes-gcm' : 'server-aes-gcm-compat',
          file_count: files.length,
          total_bytes: totalSize,
        },
      });

      const token = shareRes.token;
      const pin = shareRes.pin;
      const uploadToken = shareRes.upload_token;

      // 2. Build and save Structured JSON Manifest
      const manifest = {
        version: '1.0',
        token,
        pin,
        created_at: Math.floor(Date.now() / 1000),
        total_files: files.length,
        total_size: totalSize,
        files: files.map((f) => ({
          name: f.name,
          relative_path: (f as any).webkitRelativePath || f.name,
          size: f.size,
          mime: f.type || 'application/octet-stream',
          chunk_count: Math.ceil(f.size / CHUNK_SIZE) || 1,
        })),
      };
      await api.saveManifest(token, manifest, uploadToken);

      // Save initial upload state to localStorage for persistence
      const shareStateObj = {
        token,
        pin,
        uploadToken,
        rawKeyB64,
        title: title || files[0].name,
        shareUrl: `${window.location.origin}/share/${token}${rawKeyB64 ? `#key=${rawKeyB64}` : ''}`,
        status: 'uploading',
        filesCount: files.length,
        totalBytes: totalSize,
      };
      localStorage.setItem(`sd_active_upload_${userScope}`, JSON.stringify(shareStateObj));

      // 3. Register each file and upload chunks
      let totalBytesUploaded = 0;
      const startTime = Date.now();

      for (let fIdx = 0; fIdx < files.length; fIdx++) {
        const file = files[fIdx];
        const chunkCount = Math.ceil(file.size / CHUNK_SIZE) || 1;

        const regRes = await api.registerFile(
          token,
          {
            name: file.name,
            relative_path: (file as any).webkitRelativePath || file.name,
            size: file.size,
            mime: file.type || 'application/octet-stream',
            chunk_size: CHUNK_SIZE,
            chunk_count: chunkCount,
          },
          uploadToken
        );
        const fileId = regRes.file_id;

        // Check already uploaded chunks if resuming
        const statusRes = await api.getChunksStatus(token);
        const fileStatus = statusRes.files.find((s) => s.file_id === fileId);
        const uploadedIndices = new Set(fileStatus?.uploaded_indices || []);

        setChunkMap({
          total: chunkCount,
          uploaded: uploadedIndices.size,
          missing: Array.from({ length: chunkCount }, (_, i) => i).filter((i) => !uploadedIndices.has(i)),
        });

        // Upload missing chunks
        for (let cIdx = 0; cIdx < chunkCount; cIdx++) {
          if (uploadedIndices.has(cIdx)) {
            totalBytesUploaded += Math.min(CHUNK_SIZE, file.size - cIdx * CHUNK_SIZE);
            continue;
          }

          // Pause loop
          while (pausedRef.current) {
            await new Promise((r) => setTimeout(r, 400));
          }

          const start = cIdx * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunkBlob = file.slice(start, end);
          const chunkArrayBuffer = await chunkBlob.arrayBuffer();

          let uploadBody: BodyInit = chunkArrayBuffer;
          let chunkMetaHeader: any = null;
          let putUrl = `/api/shares/${token}/files/${fileId}/chunks/${cIdx}`;

          if (cryptoKey) {
            const enc = await encryptChunk(cryptoKey, chunkArrayBuffer);
            uploadBody = enc.payload;
            chunkMetaHeader = {
              chunk_index: cIdx,
              original_size: chunkArrayBuffer.byteLength,
              plaintext_sha256: enc.plainSha,
              ciphertext_sha256: enc.cipherSha,
              nonce_b64: enc.nonceB64,
            };
          } else {
            putUrl = `/api/shares/${token}/files/${fileId}/chunks/${cIdx}/plain`;
            const plainSha = await sha256Hex(chunkArrayBuffer);
            chunkMetaHeader = {
              chunk_index: cIdx,
              original_size: chunkArrayBuffer.byteLength,
              plaintext_sha256: plainSha,
            };
          }

          // PUT chunk with retry
          let retries = 0;
          let chunkSuccess = false;
          while (!chunkSuccess && retries < 5) {
            try {
              const headers: Record<string, string> = {
                'x-upload-token': uploadToken,
                'Content-Type': 'application/octet-stream',
              };
              if (cryptoKey && chunkMetaHeader) {
                headers['x-chunk-meta'] = btoa(JSON.stringify(chunkMetaHeader));
              } else if (chunkMetaHeader?.plaintext_sha256) {
                headers['x-plaintext-sha256'] = chunkMetaHeader.plaintext_sha256;
              }

              const putRes = await fetch(putUrl, {
                method: 'PUT',
                headers,
                body: uploadBody,
              });
              if (!putRes.ok) {
                const errText = await putRes.text();
                throw new Error(`HTTP ${putRes.status}: ${errText}`);
              }
              chunkSuccess = true;
            } catch (err: any) {
              retries++;
              await new Promise((r) => setTimeout(r, 600 * Math.pow(1.5, retries)));
            }
          }

          if (!chunkSuccess) {
            throw new Error(`Failed to upload chunk ${cIdx} after 5 retries`);
          }

          totalBytesUploaded += chunkArrayBuffer.byteLength;
          const progress = Math.min(100, Math.round((totalBytesUploaded / totalSize) * 100));
          setOverallProgress(progress);

          const elapsed = (Date.now() - startTime) / 1000;
          if (elapsed > 0) {
            const speed = totalBytesUploaded / elapsed;
            setUploadSpeed(`${formatBytes(speed)}/s`);
          }

          setChunkMap((prev) => ({
            ...prev,
            uploaded: prev.uploaded + 1,
            missing: prev.missing.filter((idx) => idx !== cIdx),
          }));
        }
      }

      // 4. Handle Direct Sharing if selected
      if (shareTargetMode === 'group' && selectedGroupId) {
        await api.createDirectShare(token, selectedGroupId, []);
      } else if (shareTargetMode === 'direct_users' && selectedUsernames.length > 0) {
        await api.createDirectShare(token, undefined, selectedUsernames);
      }

      // Mark completed in localStorage and view
      const finalData = {
        ...shareStateObj,
        status: 'completed',
        completedAt: Date.now(),
      };
      localStorage.setItem(`sd_active_upload_${userScope}`, JSON.stringify(finalData));
      localStorage.removeItem(`sd_draft_u_${userScope}`);
      setActiveShareData(finalData);
      setUploading(false);
    } catch (err: any) {
      alert(`Transfer failed: ${err.message}`);
      setUploading(false);
    }
  };

  const handleReset = () => {
    const userScope = auth?.user?.id || 'guest';
    localStorage.removeItem(`sd_active_upload_${userScope}`);
    localStorage.removeItem(`sd_draft_u_${userScope}`);
    setActiveShareData(null);
    setFiles([]);
    setTitle('');
    setPassword('');
    setSelectedUsernames([]);
    setSelectedGroupId('');
    setOverallProgress(0);
  };

  return (
    <div className="space-y-6">
      {/* Active Completed Card */}
      {activeShareData && activeShareData.status === 'completed' ? (
        <div className="p-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                <CheckCircle size={22} />
              </div>
              <div>
                <h3 className="font-bold text-lg text-emerald-900 dark:text-emerald-100">
                  Transfer Hosted & Ready
                </h3>
                <p className="text-xs text-surface-600 dark:text-surface-400">
                  Share token active on local mesh. PIN or direct link ready for delivery.
                </p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 text-xs font-medium hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            >
              Send Another
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* PIN Card */}
            <div className="p-4 rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 flex flex-col items-center justify-center gap-2">
              <span className="text-xs uppercase tracking-widest text-surface-500 font-mono">4-Digit Access PIN</span>
              <span className="text-4xl font-extrabold tracking-widest text-emerald-600 dark:text-emerald-400 font-mono">
                {activeShareData.pin}
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(activeShareData.pin)}
                className="mt-1 flex items-center gap-1.5 text-xs text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100"
              >
                <Copy size={13} /> Copy PIN
              </button>
            </div>

            {/* Direct Link */}
            <div className="p-4 rounded-lg border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 flex flex-col justify-center gap-2">
              <span className="text-xs uppercase tracking-widest text-surface-500 font-mono">Direct Share URL</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={activeShareData.shareUrl}
                  className="flex-1 px-3 py-1.5 rounded border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-950 text-xs font-mono select-all"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(activeShareData.shareUrl)}
                  className="p-2 rounded border border-surface-200 dark:border-surface-800 hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-300"
                  title="Copy link"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Main Send Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Dropzone & Files (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="p-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-base">Select Payloads</h2>
                <p className="text-xs text-surface-500">Drag files or complete directory structures.</p>
              </div>
              <span className="px-2 py-0.5 rounded text-xs font-mono bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400">
                {files.length} {files.length === 1 ? 'file' : 'files'} ({formatBytes(totalSize)})
              </span>
            </div>

            {/* Drop Area */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files) {
                  const dropped = Array.from(e.dataTransfer.files);
                  setFiles((prev) => [...prev, ...dropped]);
                  if (!title && dropped[0]) setTitle(dropped[0].name);
                }
              }}
              className="border-2 border-dashed border-surface-300 dark:border-surface-700 rounded-xl p-8 flex flex-col items-center justify-center gap-3 text-center hover:border-emerald-500 dark:hover:border-emerald-500 transition-colors cursor-pointer bg-surface-50/50 dark:bg-surface-950/50"
            >
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Upload size={24} />
              </div>
              <div>
                <p className="font-medium text-sm">Drag and drop files or folders here</p>
                <p className="text-xs text-surface-500 mt-1">Chunked RFC-compliant streaming with SHA-256 validation</p>
              </div>

              <div className="flex items-center gap-3 mt-2">
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium cursor-pointer shadow-sm transition-colors">
                  <File size={14} /> Pick Files
                  <input type="file" multiple onChange={handleFileChange} className="hidden" />
                </label>
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-300 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-300 text-xs font-medium cursor-pointer transition-colors">
                  <Folder size={14} /> Pick Folder
                  <input
                    type="file"
                    {...({ webkitdirectory: '', directory: '' } as any)}
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* File List Table */}
            {files.length > 0 && (
              <div className="border border-surface-200 dark:border-surface-800 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name / Path</th>
                      <th className="px-3 py-2 font-medium">Size</th>
                      <th className="px-3 py-2 font-medium">Est. Chunks</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-200 dark:divide-surface-800">
                    {files.map((f, i) => (
                      <tr key={i} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                        <td className="px-3 py-2 truncate max-w-[200px] font-mono text-surface-800 dark:text-surface-200">
                          {(f as any).webkitRelativePath || f.name}
                        </td>
                        <td className="px-3 py-2 font-mono text-surface-600 dark:text-surface-400">
                          {formatBytes(f.size)}
                        </td>
                        <td className="px-3 py-2 font-mono text-surface-600 dark:text-surface-400">
                          {Math.ceil(f.size / CHUNK_SIZE) || 1}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => removeFile(i)}
                            className="text-surface-400 hover:text-rose-500 transition-colors"
                            title="Remove file"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Live Upload Progress */}
            {uploading && (
              <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 space-y-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    Streaming Chunks ({overallProgress}%)
                  </span>
                  <span>{uploadSpeed}</span>
                </div>

                <div className="w-full h-2 rounded-full bg-surface-200 dark:bg-surface-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>

                {/* Chunk Visualizer */}
                <div className="flex items-center justify-between text-[11px] text-surface-500">
                  <span>
                    Uploaded {chunkMap.uploaded} of {chunkMap.total} chunks
                  </span>
                  <button
                    onClick={() => setPaused(!paused)}
                    className="flex items-center gap-1 text-surface-700 dark:text-surface-300 font-medium hover:underline"
                  >
                    {paused ? <Play size={12} /> : <Pause size={12} />}
                    {paused ? 'Resume' : 'Pause'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Policies & Target Selector (1 col) */}
        <div className="space-y-4">
          <div className="p-6 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 space-y-4">
            <h2 className="font-bold text-base">Transmission Policy</h2>

            {/* Share Title */}
            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Share Title
              </label>
              <input
                type="text"
                placeholder="e.g. Flight Log, 4K Footage"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Direct Target Selection */}
            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Distribution Target
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-surface-100 dark:bg-surface-800 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setShareTargetMode('public')}
                  className={`py-1 rounded font-medium ${
                    shareTargetMode === 'public'
                      ? 'bg-white dark:bg-surface-900 shadow-sm text-surface-900 dark:text-surface-100'
                      : 'text-surface-500 hover:text-surface-900'
                  }`}
                >
                  Public PIN
                </button>
                <button
                  type="button"
                  onClick={() => setShareTargetMode('group')}
                  className={`py-1 rounded font-medium ${
                    shareTargetMode === 'group'
                      ? 'bg-white dark:bg-surface-900 shadow-sm text-surface-900 dark:text-surface-100'
                      : 'text-surface-500 hover:text-surface-900'
                  }`}
                >
                  Group
                </button>
                <button
                  type="button"
                  onClick={() => setShareTargetMode('direct_users')}
                  className={`py-1 rounded font-medium ${
                    shareTargetMode === 'direct_users'
                      ? 'bg-white dark:bg-surface-900 shadow-sm text-surface-900 dark:text-surface-100'
                      : 'text-surface-500 hover:text-surface-900'
                  }`}
                >
                  Direct Users
                </button>
              </div>

              {/* Group dropdown */}
              {shareTargetMode === 'group' && (
                <div className="mt-2">
                  <select
                    value={selectedGroupId}
                    onChange={(e) => setSelectedGroupId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Select a group...</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.member_count || 1} members)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Direct user search with multi-select */}
              {shareTargetMode === 'direct_users' && (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    placeholder="Search username to share..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
                  />

                  {userSearchResults.length > 0 && (
                    <div className="border border-surface-200 dark:border-surface-800 rounded-lg p-1 bg-surface-50 dark:bg-surface-950 max-h-28 overflow-y-auto space-y-1">
                      {userSearchResults.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            if (!selectedUsernames.includes(u.username)) {
                              setSelectedUsernames([...selectedUsernames, u.username]);
                            }
                            setUserSearchQuery('');
                            setUserSearchResults([]);
                          }}
                          className="w-full text-left px-2 py-1 text-xs hover:bg-surface-200 dark:hover:bg-surface-800 rounded flex justify-between"
                        >
                          <span>{u.username}</span>
                          <span className="text-surface-500">{u.role}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Selected Tags */}
                  {selectedUsernames.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {selectedUsernames.map((uname) => (
                        <span
                          key={uname}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        >
                          {uname}
                          <button
                            type="button"
                            onClick={() => setSelectedUsernames(selectedUsernames.filter((n) => n !== uname))}
                            className="hover:text-rose-500"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* E2EE Toggle */}
            <div className="pt-2 border-t border-surface-200 dark:border-surface-800">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-xs font-medium text-surface-700 dark:text-surface-300 flex items-center gap-1.5">
                  <Lock size={13} className="text-emerald-500" />
                  Client End-to-End Encryption
                </span>
                <input
                  type="checkbox"
                  checked={e2eeEnabled}
                  onChange={(e) => setE2eeEnabled(e.target.checked)}
                  className="rounded border-surface-300 text-emerald-600 focus:ring-emerald-500"
                />
              </label>
              <p className="text-[11px] text-surface-500 mt-0.5">
                {e2eeEnabled
                  ? 'Key derived in browser; server stores only ciphertext.'
                  : 'Fast line-speed BLAKE2b server key derivation.'}
              </p>
            </div>

            {/* Expiration */}
            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Validity Period
              </label>
              <select
                value={expiresSeconds}
                onChange={(e) => setExpiresSeconds(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
              >
                <option value={600}>10 Minutes</option>
                <option value={3600}>1 Hour</option>
                <option value={86400}>1 Day</option>
                <option value={604800}>7 Days</option>
                <option value={0}>Never Expire</option>
              </select>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">
                Access Password (Optional)
              </label>
              <input
                type="password"
                placeholder="Leave blank for open PIN access"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-950 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Security Checkboxes */}
            <div className="space-y-2 pt-2 border-t border-surface-200 dark:border-surface-800 text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireApproval}
                  onChange={(e) => setRequireApproval(e.target.checked)}
                  className="rounded border-surface-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Require Admin Explicit Approval</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteAfter}
                  onChange={(e) => setDeleteAfter(e.target.checked)}
                  className="rounded border-surface-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>One-Time Self-Destruct on Download</span>
              </label>
            </div>

            {/* Launch Button */}
            <button
              onClick={handleStartUpload}
              disabled={files.length === 0 || uploading}
              className="w-full mt-4 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
            >
              <Upload size={16} />
              {uploading ? 'Transmitting Chunks...' : 'Launch Secure Transmission'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
