export function keyBytes(secret?: string): Uint8Array {
  if (!secret) throw new Error("session secret is not set");
  const bytes = new Uint8Array(secret.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(secret.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
