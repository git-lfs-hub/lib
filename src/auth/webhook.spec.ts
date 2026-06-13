import { test, expect, describe } from 'vitest';

import { verifyWebhookSignature } from './webhook';

const SECRET = 'webhook-secret';

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256=${hex}`;
}

describe('verifyWebhookSignature', () => {
  test('accepts a correct signature', async () => {
    const body = '{"action":"deleted"}';
    expect(await verifyWebhookSignature(body, await sign(body), SECRET)).toBe(true);
  });

  test('rejects a signature for a different body', async () => {
    expect(await verifyWebhookSignature('{}', await sign('tampered'), SECRET)).toBe(false);
  });

  test('rejects a signature under a different secret', async () => {
    const body = '{}';
    expect(await verifyWebhookSignature(body, await sign(body, 'other'), SECRET)).toBe(false);
  });

  test('rejects missing signature', async () => {
    expect(await verifyWebhookSignature('{}', undefined, SECRET)).toBe(false);
  });

  test('rejects signature without the sha256= prefix', async () => {
    const raw = (await sign('{}')).slice('sha256='.length);
    expect(await verifyWebhookSignature('{}', raw, SECRET)).toBe(false);
  });

  test('rejects malformed hex', async () => {
    expect(await verifyWebhookSignature('{}', 'sha256=zzz', SECRET)).toBe(false);
  });
});
