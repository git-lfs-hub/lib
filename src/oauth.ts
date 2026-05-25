import { SignJWT, jwtVerify } from "jose";
import { keyBytes } from "./_key";

export interface StatePayload {
  redirect_uri: string;
  client_state: string;
  scopes: string;
}

export async function signState(
  payload: StatePayload,
  secret: string,
  ttlSeconds = 600,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(keyBytes(secret));
}

export async function verifyState(
  token: string,
  secret: string,
): Promise<StatePayload | null> {
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

export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  opts?: { scope?: string; login?: string },
): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  if (opts?.scope) url.searchParams.set("scope", opts.scope);
  if (opts?.login) url.searchParams.set("login", opts.login);
  return url.toString();
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<Record<string, string>> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params,
  });
  return res.json() as Promise<Record<string, string>>;
}
