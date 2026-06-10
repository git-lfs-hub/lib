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
