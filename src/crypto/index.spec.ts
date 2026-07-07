import { test, expect, describe } from 'vitest';

import {
  generateKeypair,
  keyBytes,
  hexToBytes,
  sha256hex,
  signChallenge,
  signHmac,
  verifyChallenge,
  verifyHmac,
} from './index';

describe('keyBytes', () => {
  test('decodes a hex secret to bytes', () => {
    expect([...keyBytes('00ff10')]).toEqual([0, 255, 16]);
  });

  test('throws when the secret is absent', () => {
    expect(() => keyBytes()).toThrow('session secret is not set');
    expect(() => keyBytes('')).toThrow('session secret is not set');
  });

  test('throws when the secret is not valid hex', () => {
    expect(() => keyBytes('0g')).toThrow('session secret is not valid hex');
    expect(() => keyBytes('abc')).toThrow('session secret is not valid hex');
  });
});

describe('Ed25519 node identity', () => {
  test('a fresh keypair signs a challenge its public key verifies', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const sig = await signChallenge('node-1:12345', privateKey);
    expect(await verifyChallenge('node-1:12345', sig, publicKey)).toBe(true);
  });

  test('rejects a tampered message', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const sig = await signChallenge('node-1:12345', privateKey);
    expect(await verifyChallenge('node-1:99999', sig, publicKey)).toBe(false);
  });

  test('rejects a signature from a different key', async () => {
    const a = await generateKeypair();
    const b = await generateKeypair();
    const sig = await signChallenge('m', a.privateKey);
    expect(await verifyChallenge('m', sig, b.publicKey)).toBe(false);
  });

  test('fails closed on malformed base64 inputs', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const sig = await signChallenge('m', privateKey);
    expect(await verifyChallenge('m', '!!!', publicKey)).toBe(false);
    expect(await verifyChallenge('m', sig, '!!!')).toBe(false);
  });
});

describe('sha256hex', () => {
  test('lowercase hex digest of a UTF-8 string', async () => {
    expect(await sha256hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('empty string', async () => {
    expect(await sha256hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('node credential', () => {
  const SECRET = 'fleet-secret';

  test('a token signed for a node verifies', async () => {
    const token = await signHmac('node-1', SECRET);
    expect(await verifyHmac('node-1', token, SECRET)).toBe(true);
  });

  test('a token for another node fails', async () => {
    const token = await signHmac('node-1', SECRET);
    expect(await verifyHmac('node-2', token, SECRET)).toBe(false);
  });

  test('a token under another secret fails', async () => {
    const token = await signHmac('node-1', SECRET);
    expect(await verifyHmac('node-1', token, 'other-secret')).toBe(false);
  });

  test('a malformed token fails', async () => {
    expect(await verifyHmac('node-1', 'zz', SECRET)).toBe(false);
  });
});

describe('hexToBytes', () => {
  test('decodes lower/upper hex', () => {
    expect([...hexToBytes('deadBEEF')!]).toEqual([222, 173, 190, 239]);
  });

  test('null on empty', () => {
    expect(hexToBytes('')).toBeNull();
  });

  test('null on odd length', () => {
    expect(hexToBytes('abc')).toBeNull();
  });

  test('null on non-hex chars', () => {
    expect(hexToBytes('zz')).toBeNull();
    expect(hexToBytes('0g')).toBeNull();
  });
});
