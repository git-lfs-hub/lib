import { EncryptJWT, jwtDecrypt } from "jose";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { keyBytes } from "./_key";

export const SESSION_COOKIE = "gh_session_v2";
export const SESSION_TTL = 86400; // 1 day

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
  maxAge: SESSION_TTL,
};

export interface SessionPayload {
  token: string;
  refresh_token?: string;
}

export async function setSessionCookie(
  c: Context,
  payload: SessionPayload,
  secret: string,
): Promise<void> {
  const value = await encryptSession(payload, secret, SESSION_TTL);
  setCookie(c, SESSION_COOKIE, value, SESSION_COOKIE_OPTIONS);
}

export async function getSessionCookie(
  c: Context,
  secret: string,
): Promise<SessionPayload | null> {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return null;
  return decryptSession(raw, secret);
}

export async function encryptSession(
  payload: SessionPayload,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .encrypt(keyBytes(secret));
}

export async function decryptSession(
  token: string,
  secret?: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtDecrypt(token, keyBytes(secret));
    const result: SessionPayload = { token: payload.token as string };
    if (typeof payload.refresh_token === "string")
      result.refresh_token = payload.refresh_token;
    return result;
  } catch {
    return null;
  }
}
