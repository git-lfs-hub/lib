// SHA-256 of a UTF-8 string as lowercase hex. Cache keys / state tokens, not an auth boundary.
export async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function keyBytes(secret?: string): Uint8Array {
  if (!secret) throw new Error('session secret is not set');
  const bytes = hexToBytes(secret);
  if (!bytes) throw new Error('session secret is not valid hex');
  return bytes;
}

// A per-node WS credential derives from the fleet secret, so a managed node stores no secret
// and the secret alone gates forgery.
const HMAC = { name: 'HMAC', hash: 'SHA-256' } as const;

export async function signHmac(message: string, secret: string): Promise<string> {
  const key = await hmacKey(secret, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyHmac(message: string, token: string, secret: string): Promise<boolean> {
  const provided = hexToBytes(token);
  if (!provided) return false;
  const key = await hmacKey(secret, ['verify']);
  return crypto.subtle.verify('HMAC', key, provided, new TextEncoder().encode(message));
}

function hmacKey(secret: string, usages: ('sign' | 'verify')[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), HMAC, false, usages);
}

// Node identity: the server stores only the public key, so signing a fresh challenge is the
// credential and `nodeId` stays a non-secret identifier.
const ED25519 = { name: 'Ed25519' } as const;

export async function generateKeypair(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify'])) as {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
  };
  const [pub, priv] = (await Promise.all([
    crypto.subtle.exportKey('spki', pair.publicKey),
    crypto.subtle.exportKey('pkcs8', pair.privateKey),
  ])) as [ArrayBuffer, ArrayBuffer];
  return {
    publicKey: bytesToBase64(new Uint8Array(pub)),
    privateKey: bytesToBase64(new Uint8Array(priv)),
  };
}

export async function signChallenge(message: string, privateKey: string): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', base64ToBytes(privateKey)!, ED25519, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign(ED25519, key, new TextEncoder().encode(message));
  return bytesToBase64(new Uint8Array(sig));
}

// Fail closed on any bad input (unparseable key/sig, verify throw) — this gates the WS upgrade.
export async function verifyChallenge(
  message: string,
  signature: string,
  publicKey: string,
): Promise<boolean> {
  const pub = base64ToBytes(publicKey);
  const sig = base64ToBytes(signature);
  if (!pub || !sig) return false;
  try {
    const key = await crypto.subtle.importKey('spki', pub, ED25519, false, ['verify']);
    return await crypto.subtle.verify(ED25519, key, sig, new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

// `base64ToBytes` returns null on invalid input — untrusted data must fail closed.
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// Decode a hex string to bytes; null on empty / odd length / non-hex. Used for untrusted
// input (e.g. a webhook `sha256=<hex>` signature) where a bad value must fail closed.
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null; // parseInt is lenient ("0g" → 0); reject up front
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
