import { SignJWT, jwtVerify } from 'jose';

import { keyBytes } from '../crypto';
import { githubAccessToken } from '../github/accessToken';
import { urlWithParams } from '../utils';
import { encryptSession, type SessionTokens } from './session';

const STATE_TTL = 600; // github oauth/authorize
const EPHEMERAL_CODE_TTL = 300; // loopback OAuth code

/** Sealed in signed OAuth state and recovered on callback. */
export interface OAuthState {
  /** Final client URL (loopback for Git clients). Not the GitHub redirect_uri param. */
  redirect_uri: string;
  /** Opaque value echoed back to the client (`state` query param). */
  client_state: string;
  scopes: string;
}

export async function githubOAuthUrl(opts: {
  clientId: string;
  /** Registered callback GitHub redirects to (our /login/oauth/callback). */
  callbackUrl: string;
  secret: string;
  state: OAuthState;
  login?: string;
}): Promise<string> {
  const signedState = await signState(opts.state, opts.secret);
  return urlWithParams('https://github.com/login/oauth/authorize', {
    client_id: opts.clientId,
    redirect_uri: opts.callbackUrl,
    state: signedState,
    scope: opts.state.scopes,
    login: opts.login,
  });
}

export async function signState(
  state: OAuthState,
  secret: string,
  ttl = STATE_TTL,
): Promise<string> {
  return new SignJWT({ ...state })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(keyBytes(secret));
}

export async function verifyState(token: string, secret: string): Promise<OAuthState | null> {
  try {
    const { payload } = await jwtVerify(token, keyBytes(secret));
    return {
      redirect_uri: payload.redirect_uri as string,
      client_state: payload.client_state as string,
      scopes: payload.scopes as string,
    };
  } catch {
    return null;
  }
}

export type OAuthCallbackResult =
  | {
      ok: true;
      tokens: SessionTokens;
      state: OAuthState;
    }
  | { ok: false; error: string; state?: OAuthState };

export async function oauthCallback(opts: {
  code: string | undefined;
  state: string | undefined;
  secret: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}): Promise<OAuthCallbackResult> {
  const state = opts.state ? await verifyState(opts.state, opts.secret) : null;
  if (!state) return { ok: false, error: 'invalid_state' };

  const fail = (error: string): OAuthCallbackResult => ({ ok: false, error, state });

  if (!opts.code) return fail('missing_code');

  // Authorization-code grant: exchange the one-time `code` from GitHub's redirect
  // for the first access_token (and optional refresh_token). Used at login only.
  const data = await githubAccessToken({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.callbackUrl,
  });

  if (data.error || !data.access_token) return fail(data.error ?? 'no_token');

  const tokens: SessionTokens = {
    access: data.access_token,
    refresh: data.refresh_token,
  };
  return { ok: true, tokens, state };
}

/** Loopback redirect after OAuth success (`?code=…` ephemeral JWE). Server Git-proxy only. */
export async function oauthSuccessUrl(
  tokens: SessionTokens,
  state: OAuthState,
  secret: string,
): Promise<string> {
  const code = await encryptSession(tokens, secret, EPHEMERAL_CODE_TTL);
  return urlWithParams(state.redirect_uri, { code, state: state.client_state });
}

/** Loopback redirect after OAuth failure (`?error=…`). Caller must have a recovered state. */
export function oauthErrorUrl(state: OAuthState, error: string): string {
  return urlWithParams(state.redirect_uri, { error, state: state.client_state });
}
