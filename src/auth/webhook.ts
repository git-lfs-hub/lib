import { signHmac, verifyHmac } from '../crypto';

// GitHub-style `sha256=<hex>` HMAC-SHA256 over a raw body — the outbound counterpart of
// verifyWebhookSignature, so a receiver verifies with the same shared secret.
export async function signWebhook(body: string, secret: string): Promise<string> {
  return `sha256=${await signHmac(body, secret)}`;
}

// Verify a GitHub-style `sha256=<hex>` signature. Missing/malformed/mismatched → false (fail
// closed); callers reject with 401 before parsing.
export async function verifyWebhookSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature?.startsWith('sha256=')) return false;
  return verifyHmac(body, signature.slice('sha256='.length), secret);
}
