import { describe, test, expect } from "vitest";
import { Hono } from "hono";
import {
  encryptSession,
  decryptSession,
  setSessionCookie,
  getSessionCookie,
  type SessionPayload,
} from "./session";

const TEST_TTL = 60;

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

const PAYLOAD: SessionPayload = { token: "ghu_test_token" };

describe("encryptSession / decryptSession", () => {
  test("round-trip returns original payload", async () => {
    const token = await encryptSession(PAYLOAD, SECRET, TEST_TTL);
    expect(await decryptSession(token, SECRET)).toEqual(PAYLOAD);
  });

  test("preserves refresh_token when present", async () => {
    const p: SessionPayload = { token: "ghu_t", refresh_token: "ghr_r" };
    const token = await encryptSession(p, SECRET, TEST_TTL);
    expect(await decryptSession(token, SECRET)).toEqual(p);
  });

  test("each call produces a different ciphertext (random IV)", async () => {
    const a = await encryptSession(PAYLOAD, SECRET, TEST_TTL);
    const b = await encryptSession(PAYLOAD, SECRET, TEST_TTL);
    expect(a).not.toBe(b);
  });

  test("returns null for wrong secret", async () => {
    const token = await encryptSession(PAYLOAD, SECRET, TEST_TTL);
    expect(await decryptSession(token, OTHER_SECRET)).toBeNull();
  });

  test("returns null for expired token", async () => {
    const token = await encryptSession(PAYLOAD, SECRET, -1);
    expect(await decryptSession(token, SECRET)).toBeNull();
  });

  test("returns null for tampered ciphertext", async () => {
    const token = await encryptSession(PAYLOAD, SECRET, TEST_TTL);
    const parts = token.split(".");
    const c = parts[3];
    parts[3] = (c[0] === "A" ? "B" : "A") + c.slice(1);
    expect(await decryptSession(parts.join("."), SECRET)).toBeNull();
  });

  test("returns null for empty string", async () => {
    expect(await decryptSession("", SECRET)).toBeNull();
  });
});

describe("setSessionCookie / getSessionCookie", () => {
  function app() {
    const a = new Hono();
    a.get("/set", async (c) => {
      await setSessionCookie(c, PAYLOAD, SECRET);
      return c.text("ok");
    });
    a.get("/get", async (c) => c.json(await getSessionCookie(c, SECRET)));
    return a;
  }

  test("round-trips a session through the cookie", async () => {
    const a = app();
    const setRes = await a.request("/set");
    const cookie = setRes.headers.get("set-cookie")!.split(";")[0];
    const getRes = await a.request("/get", { headers: { Cookie: cookie } });
    expect(await getRes.json()).toEqual(PAYLOAD);
  });

  test("encrypts the payload in the cookie value", async () => {
    const setRes = await app().request("/set");
    const value = decodeURIComponent(
      setRes.headers.get("set-cookie")!.split(";")[0].split("=").slice(1).join("="),
    );
    expect(value).not.toContain(PAYLOAD.token);
    expect(await decryptSession(value, SECRET)).toEqual(PAYLOAD);
  });

  test("sets an httpOnly secure cookie", async () => {
    const setRes = await app().request("/set");
    const cookie = setRes.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  test("getSessionCookie returns null when no cookie present", async () => {
    const getRes = await app().request("/get");
    expect(await getRes.json()).toBeNull();
  });
});
