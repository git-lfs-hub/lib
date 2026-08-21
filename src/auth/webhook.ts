import { signHmac, verifyHmac } from '../crypto';

// Outbound counterpart of verifyWebhookSignature — same shared secret both ways.
export async function signWebhook(body: string, secret: string): Promise<string> {
  return `sha256=${await signHmac(body, secret)}`;
}

// Missing/malformed/mismatched → false (fail closed); callers reject with 401 before parsing.
export async function verifyWebhookSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature?.startsWith('sha256=')) return false;
  return verifyHmac(body, signature.slice('sha256='.length), secret);
}
