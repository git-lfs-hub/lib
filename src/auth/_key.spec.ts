import { test, expect, describe } from 'vitest';

import { keyBytes, hexToBytes } from './_key';

describe('keyBytes', () => {
  test('decodes a hex secret to bytes', () => {
    expect([...keyBytes('00ff10')]).toEqual([0, 255, 16]);
  });

  test('throws when the secret is absent', () => {
    expect(() => keyBytes()).toThrow('session secret is not set');
    expect(() => keyBytes('')).toThrow('session secret is not set');
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
