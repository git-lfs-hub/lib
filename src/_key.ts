export function keyBytes(secret: string): Uint8Array {
  if (!secret)
    throw new Error(
      "LOGIN_SECRET is not set — add it to .dev.vars (local) or wrangler secret put LOGIN_SECRET (production)",
    );
  const bytes = new Uint8Array(secret.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(secret.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
