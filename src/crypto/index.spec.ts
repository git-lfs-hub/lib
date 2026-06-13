import { test, expect, describe } from 'vitest';

import { keyBytes, hexToBytes, sha256hex } from './index';

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
