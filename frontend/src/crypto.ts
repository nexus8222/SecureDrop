// WebCrypto utilities for End-to-End Encryption (E2EE) and chunk processing

export function b64urlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function b64urlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generateAesKey(): Promise<{ key: CryptoKey; rawBase64: string }> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const exported = await crypto.subtle.exportKey('raw', key);
  const rawBase64 = b64urlEncode(exported);
  return { key, rawBase64 };
}

export async function importAesKey(rawBase64: string): Promise<CryptoKey> {
  const raw = b64urlDecode(rawBase64);
  return await crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptChunk(
  key: CryptoKey,
  plainBytes: ArrayBuffer
): Promise<{ ciphertext: ArrayBuffer; nonceB64: string; plainSha: string; cipherSha: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer },
    key,
    plainBytes
  );
  const plainSha = await sha256Hex(plainBytes);
  const cipherSha = await sha256Hex(ciphertext);
  const nonceB64 = b64urlEncode(nonce.buffer);
  return { ciphertext, nonceB64, plainSha, cipherSha };
}

export async function decryptChunk(
  key: CryptoKey,
  cipherBytes: ArrayBuffer,
  nonceB64: string
): Promise<ArrayBuffer> {
  const nonce = b64urlDecode(nonceB64);
  return await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer },
    key,
    cipherBytes
  );
}
