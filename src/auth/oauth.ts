import { SignJWT, jwtVerify } from "jose";
import { keyBytes } from "./_key";
import { githubAccessToken } from "../github/accessToken";
import { encryptSession, type SessionPayload } from "./session";

const STATE_TTL = 600; // github oauth/authorize
const EPHEMERAL_CODE_TTL = 300; // loopback OAuth code

/** Sealed in signed OAuth state and recovered on callback. */
export interface StatePayload {
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
  state: StatePayload;
  login?: string;
}): Promise<string> {
  const signedState = await signState(opts.state, opts.secret);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.callbackUrl);
  url.searchParams.set("state", signedState);
  if (opts.state.scopes) url.searchParams.set("scope", opts.state.scopes);
  if (opts.login) url.searchParams.set("login", opts.login);
  return url.toString();
}

export async function signState(payload: StatePayload, secret: string, ttl = STATE_TTL): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(keyBytes(secret));
}

export async function verifyState(token: string, secret: string): Promise<StatePayload | null> {
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
      tokenPayload: SessionPayload;
      statePayload: StatePayload;
    }
  | { ok: false; error: string; statePayload?: StatePayload };

export async function oauthCallback(opts: {
  code: string | undefined;
  state: string | undefined;
  secret: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}): Promise<OAuthCallbackResult> {
  const statePayload = opts.state ? await verifyState(opts.state, opts.secret) : null;
  if (!statePayload) return { ok: false, error: "invalid_state" };

  const fail = (error: string): OAuthCallbackResult => ({ ok: false, error, statePayload });

  if (!opts.code) return fail("missing_code");

  // Authorization-code grant: exchange the one-time `code` from GitHub's redirect
  // for the first access_token (and optional refresh_token). Used at login only.
  const data = await githubAccessToken({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.callbackUrl,
  });

  if (data.error || !data.access_token) return fail(data.error ?? "no_token");
  const tokenPayload: SessionPayload = { token: data.access_token };
  if (typeof data.refresh_token === "string") tokenPayload.refresh_token = data.refresh_token;

  return { ok: true, tokenPayload, statePayload };
}

/** Loopback redirect after OAuth failure (`?error=…`). Returns null when state could not be recovered. */
export function oauthErrorUrl(
  result: Extract<OAuthCallbackResult, { ok: false }>,
): string | null {
  if (!result.statePayload) return null;
  const url = new URL(result.statePayload.redirect_uri);
  url.searchParams.set("error", result.error);
  if (result.statePayload.client_state) url.searchParams.set("state", result.statePayload.client_state);
  return url.toString();
}

/** Loopback redirect after OAuth success (`?code=…` ephemeral JWE). Server Git-proxy only. */
export async function oauthSuccessUrl(
  result: Extract<OAuthCallbackResult, { ok: true }>,
  secret: string,
): Promise<string> {
  const ephemeralCode = await encryptSession(result.tokenPayload, secret, EPHEMERAL_CODE_TTL);
  const url = new URL(result.statePayload.redirect_uri);
  url.searchParams.set("code", ephemeralCode);
  if (result.statePayload.client_state) url.searchParams.set("state", result.statePayload.client_state);
  return url.toString();
}
