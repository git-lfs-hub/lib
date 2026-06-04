import { describe, test, expect } from "vitest";
import { Hono } from "hono";
import { EncryptJWT } from "jose";
import {
  encryptSession,
  decryptSession,
  setSessionCookie,
  getSessionCookie,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  LEGACY_COOKIE,
  ACCESS_TTL,
  REFRESH_TTL,
  type SessionTokens,
} from "./session";
import { keyBytes } from "./_key";

const TEST_TTL = 60;

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

const SESSION: SessionTokens = { access: "ghu_test_token" };

/** Rebuild a Cookie request header from a Response's Set-Cookie headers. */
function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

function setCookieFor(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

describe("setSessionCookie / getSessionCookie", () => {
  function app() {
    const a = new Hono();
    a.get("/set", async (c) => {
      await setSessionCookie(c, SESSION, SECRET);
      return c.text("ok");
    });
    a.get("/set-refresh", async (c) => {
      await setSessionCookie(c, { access: "ghu_a", refresh: "ghr_r" }, SECRET);
      return c.text("ok");
    });
    a.get("/get", async (c) => c.json(await getSessionCookie(c, SECRET)));
    return a;
  }

  test("round-trips access-only session", async () => {
    const a = app();
    const setRes = await a.request("/set");
    const getRes = await a.request("/get", { headers: { Cookie: cookieHeader(setRes) } });
    expect(await getRes.json()).toEqual(SESSION);
  });

  test("reassembles access + refresh from both cookies", async () => {
    const a = app();
    const setRes = await a.request("/set-refresh");
    const getRes = await a.request("/get", { headers: { Cookie: cookieHeader(setRes) } });
    expect(await getRes.json()).toEqual({ access: "ghu_a", refresh: "ghr_r" });
  });

  test("writes access cookie with access maxAge", async () => {
    const res = await app().request("/set");
    const access = setCookieFor(res, ACCESS_COOKIE)!;
    expect(access).toContain(`Max-Age=${ACCESS_TTL}`);
  });

  test("writes a separate refresh cookie with refresh maxAge", async () => {
    const res = await app().request("/set-refresh");
    const refresh = setCookieFor(res, REFRESH_COOKIE)!;
    expect(refresh).toContain(`Max-Age=${REFRESH_TTL}`);
  });

  test("encrypts the token in the access cookie value", async () => {
    const res = await app().request("/set");
    const value = decodeURIComponent(
      setCookieFor(res, ACCESS_COOKIE)!.split(";")[0].split("=").slice(1).join("="),
    );
    expect(value).not.toContain(SESSION.access);
  });

  test("sets an httpOnly secure cookie", async () => {
    const access = setCookieFor(await app().request("/set"), ACCESS_COOKIE)!;
    expect(access).toContain("HttpOnly");
    expect(access).toContain("Secure");
  });

  test("deletes the legacy monolithic cookie on write", async () => {
    const res = await app().request("/set");
    const legacy = setCookieFor(res, LEGACY_COOKIE)!;
    expect(legacy).toContain("Max-Age=0");
  });

  test("reads a legacy monolithic v2 cookie", async () => {
    const a = app();
    const monolith = await encryptSession(
      { access: "ghu_old", refresh: "ghr_old" },
      SECRET,
      TEST_TTL,
    );
    const getRes = await a.request("/get", {
      headers: { Cookie: `${LEGACY_COOKIE}=${monolith}` },
    });
    expect(await getRes.json()).toEqual({ access: "ghu_old", refresh: "ghr_old" });
  });

  test("returns access only when refresh cookie absent", async () => {
    const a = app();
    const setRes = await a.request("/set-refresh");
    const access = setCookieFor(setRes, ACCESS_COOKIE)!.split(";")[0];
    const getRes = await a.request("/get", { headers: { Cookie: access } });
    expect(await getRes.json()).toEqual({ access: "ghu_a" });
  });

  test("returns refresh-only session when the access cookie is gone", async () => {
    const a = app();
    const setRes = await a.request("/set-refresh");
    const refresh = setCookieFor(setRes, REFRESH_COOKIE)!.split(";")[0];
    const getRes = await a.request("/get", { headers: { Cookie: refresh } });
    expect(await getRes.json()).toEqual({ access: "", refresh: "ghr_r" });
  });

  test("omits refresh cookie when session has no refresh", async () => {
    const res = await app().request("/set");
    expect(setCookieFor(res, REFRESH_COOKIE)).toBeUndefined();
  });

  test("getSessionCookie returns null when no cookie present", async () => {
    const getRes = await app().request("/get");
    expect(await getRes.json()).toBeNull();
  });
});

describe("encryptSession / decryptSession", () => {
  test("round-trip returns original tokens", async () => {
    const token = await encryptSession(SESSION, SECRET, TEST_TTL);
    expect(await decryptSession(token, SECRET)).toEqual(SESSION);
  });

  test("preserves refresh when present", async () => {
    const tokens: SessionTokens = { access: "ghu_t", refresh: "ghr_r" };
    const token = await encryptSession(tokens, SECRET, TEST_TTL);
    expect(await decryptSession(token, SECRET)).toEqual(tokens);
  });

  test("reads a legacy `token` claim as access", async () => {
    const legacy = await new EncryptJWT({ token: "ghu_legacy" })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + TEST_TTL)
      .encrypt(keyBytes(SECRET));
    expect(await decryptSession(legacy, SECRET)).toEqual({ access: "ghu_legacy" });
  });

  test("reads legacy `access_token` / `refresh_token` claims", async () => {
    const legacy = await new EncryptJWT({ access_token: "ghu_legacy", refresh_token: "ghr_legacy" })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setExpirationTime(Math.floor(Date.now() / 1000) + TEST_TTL)
      .encrypt(keyBytes(SECRET));
    expect(await decryptSession(legacy, SECRET)).toEqual({
      access: "ghu_legacy",
      refresh: "ghr_legacy",
    });
  });

  test("each call produces a different ciphertext (random IV)", async () => {
    const a = await encryptSession(SESSION, SECRET, TEST_TTL);
    const b = await encryptSession(SESSION, SECRET, TEST_TTL);
    expect(a).not.toBe(b);
  });

  test("returns null for wrong secret", async () => {
    const token = await encryptSession(SESSION, SECRET, TEST_TTL);
    expect(await decryptSession(token, OTHER_SECRET)).toBeNull();
  });

  test("returns null for expired token", async () => {
    const token = await encryptSession(SESSION, SECRET, -1);
    expect(await decryptSession(token, SECRET)).toBeNull();
  });

  test("returns null for tampered ciphertext", async () => {
    const token = await encryptSession(SESSION, SECRET, TEST_TTL);
    const parts = token.split(".");
    const c = parts[3];
    parts[3] = (c[0] === "A" ? "B" : "A") + c.slice(1);
    expect(await decryptSession(parts.join("."), SECRET)).toBeNull();
  });

  test("returns null for empty string", async () => {
    expect(await decryptSession("", SECRET)).toBeNull();
  });
});
