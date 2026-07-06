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

// Per-node WS credential = HMAC-SHA256(secret, nodeId), hex. Derived, so a managed node needs
// no stored secret — the operator or the RunPod driver computes it from the fleet secret; the
// secret gates forgery. BYON later swaps this for per-node stored secrets.
const HMAC = { name: 'HMAC', hash: 'SHA-256' } as const;

export async function signNodeCredential(nodeId: string, secret: string): Promise<string> {
  const key = await hmacKey(secret, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(nodeId));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyNodeCredential(
  nodeId: string,
  token: string,
  secret: string,
): Promise<boolean> {
  const provided = hexToBytes(token);
  if (!provided) return false;
  const key = await hmacKey(secret, ['verify']);
  return crypto.subtle.verify('HMAC', key, provided, new TextEncoder().encode(nodeId));
}

function hmacKey(secret: string, usages: ('sign' | 'verify')[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), HMAC, false, usages);
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
