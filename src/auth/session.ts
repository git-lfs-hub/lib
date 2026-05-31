import { EncryptJWT, jwtDecrypt } from "jose";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { keyBytes } from "./_key";
import { ifString } from "../utils";

export const ACCESS_COOKIE = "gh_access"; // access only
export const REFRESH_COOKIE = "gh_refresh"; // refresh only
export const LEGACY_COOKIE = "gh_session_v2"; // monolithic, read-only

export const ACCESS_TTL = 86400; // 1 day
export const REFRESH_TTL = 15552000; // 180 day — GitHub refresh-token lifetime

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
};

export interface SessionTokens {
  access: string;
  refresh?: string;
}

// --- cookie layer: split write, split-or-legacy read ---
export async function setSessionCookie(
  c: Context,
  tokens: SessionTokens,
  secret: string,
): Promise<void> {
  setCookie(
    c,
    ACCESS_COOKIE,
    await encryptClaims({ access: tokens.access }, secret, ACCESS_TTL),
    { ...COOKIE_OPTIONS, maxAge: ACCESS_TTL },
  );
  if (tokens.refresh)
    setCookie(
      c,
      REFRESH_COOKIE,
      await encryptClaims({ refresh: tokens.refresh }, secret, REFRESH_TTL),
      { ...COOKIE_OPTIONS, maxAge: REFRESH_TTL },
    );
  deleteCookie(c, LEGACY_COOKIE, { path: "/" }); // evict monolith on migration
}

export async function getSessionCookie(
  c: Context,
  secret: string,
): Promise<SessionTokens | null> {
  const accessRaw = getCookie(c, ACCESS_COOKIE);
  if (accessRaw) {
    const accessClaims = await decryptClaims(accessRaw, secret);
    const access = ifString(accessClaims?.access);
    if (!access) return null;
    const refreshRaw = getCookie(c, REFRESH_COOKIE);
    const refreshClaims = refreshRaw ? await decryptClaims(refreshRaw, secret) : null;
    return { access, refresh: ifString(refreshClaims?.refresh) };
  }
  const legacy = getCookie(c, LEGACY_COOKIE); // monolithic v2, read-only
  return legacy ? decryptSession(legacy, secret) : null;
}

// --- monolithic encode/decode: ephemeral OAuth code + legacy v2 cookie ---
export async function encryptSession(
  tokens: SessionTokens,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return encryptClaims({ ...tokens }, secret, ttlSeconds);
}

export async function decryptSession(
  token: string,
  secret?: string,
): Promise<SessionTokens | null> {
  const claims = await decryptClaims(token, secret);
  if (!claims) return null;
  const access = ifString(claims.access ?? claims.access_token ?? claims.token); // legacy v2 / pre-rename compat
  return access ? { access, refresh: ifString(claims.refresh ?? claims.refresh_token) } : null;
}

// --- field-agnostic JWE primitives (internal) ---
async function encryptClaims(
  claims: Record<string, string | undefined>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new EncryptJWT({ ...claims })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .encrypt(keyBytes(secret));
}

async function decryptClaims(
  token: string,
  secret?: string,
): Promise<Record<string, unknown> | null> {
  try {
    return (await jwtDecrypt(token, keyBytes(secret))).payload;
  } catch {
    return null;
  }
}
