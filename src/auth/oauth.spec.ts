import { describe, test, expect, vi } from 'vitest';

import { githubAccessToken } from '../github/accessToken';
import {
  signState,
  verifyState,
  githubOAuthUrl,
  oauthErrorUrl,
  oauthSuccessUrl,
  oauthCallback,
  type OAuthState,
} from './oauth';
import { decryptSession } from './session';

const SECRET = 'a'.repeat(64);
const OTHER_SECRET = 'b'.repeat(64);

const STATE: OAuthState = {
  redirect_uri: 'http://127.0.0.1:8080/',
  client_state: 'abc123',
  scopes: 'repo,gist',
};

describe('signState / verifyState', () => {
  test('round-trip returns original payload', async () => {
    const token = await signState(STATE, SECRET);
    expect(await verifyState(token, SECRET)).toEqual(STATE);
  });

  test('returns null for wrong secret', async () => {
    const token = await signState(STATE, SECRET);
    expect(await verifyState(token, OTHER_SECRET)).toBeNull();
  });

  test('returns null for expired token', async () => {
    const token = await signState(STATE, SECRET, -1);
    expect(await verifyState(token, SECRET)).toBeNull();
  });

  test('returns null when data portion is tampered', async () => {
    const token = await signState(STATE, SECRET);
    const parts = token.split('.');
    parts[1] = parts[1].slice(0, -1) + (parts[1].endsWith('A') ? 'B' : 'A');
    expect(await verifyState(parts.join('.'), SECRET)).toBeNull();
  });

  test('returns null when signature is tampered', async () => {
    const token = await signState(STATE, SECRET);
    const parts = token.split('.');
    const sig = parts[2];
    parts[2] = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(await verifyState(parts.join('.'), SECRET)).toBeNull();
  });

  test('returns null when token has no dot separator', async () => {
    expect(await verifyState('nodothere', SECRET)).toBeNull();
  });

  test('returns null for empty string', async () => {
    expect(await verifyState('', SECRET)).toBeNull();
  });

  test('returns null for malformed base64url', async () => {
    expect(await verifyState('!!!.!!!', SECRET)).toBeNull();
  });

  test('throws when secret is empty', async () => {
    await expect(signState(STATE, '')).rejects.toThrow('session secret');
  });
});

describe('githubOAuthUrl', () => {
  test('signs state and includes it in url', async () => {
    const url = await githubOAuthUrl({
      clientId: 'cid',
      callbackUrl: 'https://cb/',
      secret: SECRET,
      state: STATE,
      login: 'alice',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('cid');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://cb/');
    expect(parsed.searchParams.get('scope')).toBe('repo,gist');
    expect(parsed.searchParams.get('login')).toBe('alice');
    const signed = parsed.searchParams.get('state')!;
    expect(await verifyState(signed, SECRET)).toEqual(STATE);
  });

  test('omits scope when scopes empty', async () => {
    const url = await githubOAuthUrl({
      clientId: 'cid',
      callbackUrl: 'https://cb/',
      secret: SECRET,
      state: { ...STATE, scopes: '' },
    });
    expect(new URL(url).searchParams.has('scope')).toBe(false);
  });
});

describe('githubAccessToken', () => {
  test('posts correct params and returns parsed JSON', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'ghu_abc', token_type: 'bearer' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await githubAccessToken({
      client_id: 'cid',
      client_secret: 'csec',
      code: 'code123',
      redirect_uri: 'https://cb/',
    });

    expect(result).toEqual({ access_token: 'ghu_abc', token_type: 'bearer' });
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect(init?.method).toBe('POST');
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('csec');
    expect(body.get('code')).toBe('code123');
    expect(body.get('redirect_uri')).toBe('https://cb/');

    spy.mockRestore();
  });

  test('returns error body from GitHub as-is', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad_verification_code' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await githubAccessToken({
      client_id: 'cid',
      client_secret: 'csec',
      code: 'bad',
      redirect_uri: 'https://cb/',
    });
    expect(result).toEqual({ error: 'bad_verification_code' });

    spy.mockRestore();
  });
});

describe('oauthErrorUrl', () => {
  test('appends error and client_state', () => {
    const url = new URL(oauthErrorUrl(STATE, 'denied'));
    expect(url.searchParams.get('error')).toBe('denied');
    expect(url.searchParams.get('state')).toBe('abc123');
  });

  test('omits client_state when empty', () => {
    const url = new URL(oauthErrorUrl({ ...STATE, client_state: '' }, 'denied'));
    expect(url.searchParams.get('error')).toBe('denied');
    expect(url.searchParams.has('state')).toBe(false);
  });
});

describe('oauthSuccessUrl', () => {
  const SESSION = { access: 'ghu_abc' };

  test('appends code and client_state', async () => {
    const url = new URL(await oauthSuccessUrl(SESSION, STATE, SECRET));
    const code = url.searchParams.get('code')!;
    expect(await decryptSession(code, SECRET)).toEqual(SESSION);
    expect(url.searchParams.get('state')).toBe('abc123');
  });

  test('omits client_state when empty', async () => {
    const url = new URL(await oauthSuccessUrl(SESSION, { ...STATE, client_state: '' }, SECRET));
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(url.searchParams.has('state')).toBe(false);
  });
});

describe('oauthCallback', () => {
  const base = {
    secret: SECRET,
    clientId: 'cid',
    clientSecret: 'csec',
    callbackUrl: 'https://cb/',
  };

  test('returns invalid_state when state missing', async () => {
    const r = await oauthCallback({ ...base, code: 'x', state: undefined });
    expect(r).toEqual({ ok: false, error: 'invalid_state' });
  });

  test('returns invalid_state when state malformed', async () => {
    const r = await oauthCallback({ ...base, code: 'x', state: 'bad' });
    expect(r).toEqual({ ok: false, error: 'invalid_state' });
  });

  test('returns missing_code when code missing', async () => {
    const signed = await signState(STATE, SECRET);
    const r = await oauthCallback({ ...base, code: undefined, state: signed });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('missing_code');
      expect(r.state).toEqual(STATE);
    }
  });

  test('returns no_token when exchange yields no access_token', async () => {
    const signed = await signState(STATE, SECRET);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const r = await oauthCallback({ ...base, code: 'x', state: signed });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('no_token');
    spy.mockRestore();
  });

  test('propagates exchange error', async () => {
    const signed = await signState(STATE, SECRET);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad_verification_code' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const r = await oauthCallback({ ...base, code: 'x', state: signed });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad_verification_code');
    spy.mockRestore();
  });

  test('returns ok with tokens and state on success', async () => {
    const signed = await signState(STATE, SECRET);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'ghu_abc', refresh_token: 'ghr_r' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const r = await oauthCallback({ ...base, code: 'x', state: signed });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tokens).toEqual({ access: 'ghu_abc', refresh: 'ghr_r' });
      expect(r.state).toEqual(STATE);
    }
    spy.mockRestore();
  });

  test('omits refresh_token when GitHub returns none', async () => {
    const signed = await signState(STATE, SECRET);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'ghu_abc' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const r = await oauthCallback({ ...base, code: 'x', state: signed });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tokens).toEqual({ access: 'ghu_abc' });
    spy.mockRestore();
  });
});
