import { EncryptJWT, jwtDecrypt } from "jose";
import { Octokit } from "@octokit/rest";
import { keyBytes } from "./_key";

export interface SessionPayload {
  token: string;
  refresh_token?: string;
}

export interface Session {
  token: string;
  username: string;
}

export async function encryptSession(
  payload: SessionPayload,
  secret: string,
  ttlSeconds = 300,
): Promise<string> {
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .encrypt(keyBytes(secret));
}

export async function decryptSession(
  token: string,
  secret: string,
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

export async function validateSession(
  cookie: string | undefined,
  secret: string,
): Promise<Session | null> {
  if (!cookie) return null;
  const payload = await decryptSession(cookie, secret);
  if (!payload) return null;
  const octokit = new Octokit({ auth: payload.token });
  const username = await octokit.rest.users
    .getAuthenticated()
    .then(({ data }) => data.login)
    .catch(() => null);
  if (!username) return null;
  return { token: payload.token, username };
}
