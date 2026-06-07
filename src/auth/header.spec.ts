import { describe, test, expect } from 'vitest';

import { authHeaderToken } from './header';

describe('authHeaderToken', () => {
  describe('Basic scheme', () => {
    test('returns username and password from valid Basic credentials', () => {
      const result = authHeaderToken(`Basic ${btoa('alice:secret')}`);
      expect(result).toEqual({ username: 'alice', token: 'secret' });
    });

    test('splits on the first colon only (password may contain colons)', () => {
      const result = authHeaderToken(`Basic ${btoa('alice:pass:with:colons')}`);
      expect(result).toEqual({ username: 'alice', token: 'pass:with:colons' });
    });

    test('allows an empty username', () => {
      const result = authHeaderToken(`Basic ${btoa(':token-only')}`);
      expect(result).toEqual({ username: '', token: 'token-only' });
    });

    test('returns null for malformed base64', () => {
      expect(authHeaderToken('Basic !!!not-base64!!!')).toBeNull();
    });

    test('returns null when decoded value has no colon', () => {
      expect(authHeaderToken(`Basic ${btoa('nocohereseparator')}`)).toBeNull();
    });

    test('scheme matching is case-insensitive', () => {
      expect(authHeaderToken(`BASIC ${btoa('alice:secret')}`)).toEqual({
        username: 'alice',
        token: 'secret',
      });
    });
  });

  describe('non-Basic schemes', () => {
    test('RemoteAuth: treats raw credential as token, username empty', () => {
      expect(authHeaderToken('RemoteAuth my-opaque-token')).toEqual({
        username: '',
        token: 'my-opaque-token',
      });
    });

    test('Bearer: treats raw credential as token', () => {
      expect(authHeaderToken('Bearer eyJhbGciOiJIUzI1NiJ9')).toEqual({
        username: '',
        token: 'eyJhbGciOiJIUzI1NiJ9',
      });
    });
  });

  test('returns null when no space separates scheme from credentials', () => {
    expect(authHeaderToken('BasicYWxpY2U6c2VjcmV0')).toBeNull();
  });
});
