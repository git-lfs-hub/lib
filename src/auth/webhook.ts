import { hexToBytes } from './_key';

// Verify a GitHub-style `sha256=<hex>` HMAC-SHA256 signature over a raw request body.
// `crypto.subtle.verify` is constant-time, so decode the supplied hex and let it compare.
// Missing/malformed/mismatched → false (fail closed); callers reject with 401 before parsing.
export async function verifyWebhookSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature?.startsWith('sha256=')) return false;
  const provided = hexToBytes(signature.slice('sha256='.length));
  if (!provided) return false;

  const encoder = new TextEncoder();
  const algo = { name: 'HMAC', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), algo, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, provided, encoder.encode(body));
}
