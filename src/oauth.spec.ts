import { describe, test, expect, vi } from "vitest";
import { signState, verifyState, buildAuthorizeUrl, exchangeCode, type StatePayload } from "./oauth";

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

const STATE: StatePayload = {
  redirect_uri: "http://127.0.0.1:8080/",
  client_state: "abc123",
  scopes: "repo,gist",
};

describe("signState / verifyState", () => {
  test("round-trip returns original payload", async () => {
    const token = await signState(STATE, SECRET);
    expect(await verifyState(token, SECRET)).toEqual(STATE);
  });

  test("returns null for wrong secret", async () => {
    const token = await signState(STATE, SECRET);
    expect(await verifyState(token, OTHER_SECRET)).toBeNull();
  });

  test("returns null for expired token", async () => {
    const token = await signState(STATE, SECRET, -1);
    expect(await verifyState(token, SECRET)).toBeNull();
  });

  test("returns null when data portion is tampered", async () => {
    const token = await signState(STATE, SECRET);
    const parts = token.split(".");
    parts[1] = parts[1].slice(0, -1) + (parts[1].endsWith("A") ? "B" : "A");
    expect(await verifyState(parts.join("."), SECRET)).toBeNull();
  });

  test("returns null when signature is tampered", async () => {
    const token = await signState(STATE, SECRET);
    const parts = token.split(".");
    const sig = parts[2];
    parts[2] = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(await verifyState(parts.join("."), SECRET)).toBeNull();
  });

  test("returns null when token has no dot separator", async () => {
    expect(await verifyState("nodothere", SECRET)).toBeNull();
  });

  test("returns null for empty string", async () => {
    expect(await verifyState("", SECRET)).toBeNull();
  });

  test("returns null for malformed base64url", async () => {
    expect(await verifyState("!!!.!!!", SECRET)).toBeNull();
  });

  test("throws when secret is empty", async () => {
    await expect(signState(STATE, "")).rejects.toThrow("LOGIN_SECRET");
  });
});

describe("buildAuthorizeUrl", () => {
  test("includes client_id, redirect_uri, state", () => {
    const url = new URL(buildAuthorizeUrl("cid", "https://cb/", "st"));
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://cb/");
    expect(url.searchParams.get("state")).toBe("st");
  });

  test("includes scope when provided", () => {
    const url = new URL(buildAuthorizeUrl("cid", "https://cb/", "st", { scope: "repo" }));
    expect(url.searchParams.get("scope")).toBe("repo");
  });

  test("omits scope when not provided", () => {
    const url = new URL(buildAuthorizeUrl("cid", "https://cb/", "st"));
    expect(url.searchParams.has("scope")).toBe(false);
  });

  test("includes login when provided", () => {
    const url = new URL(buildAuthorizeUrl("cid", "https://cb/", "st", { login: "alice" }));
    expect(url.searchParams.get("login")).toBe("alice");
  });

  test("points to github.com/login/oauth/authorize", () => {
    const url = new URL(buildAuthorizeUrl("cid", "https://cb/", "st"));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
  });
});

describe("exchangeCode", () => {
  test("posts correct params and returns parsed JSON", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "ghu_abc", token_type: "bearer" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await exchangeCode("cid", "csec", "code123", "https://cb/");

    expect(result).toEqual({ access_token: "ghu_abc", token_type: "bearer" });
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(init?.body as string);
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("csec");
    expect(body.get("code")).toBe("code123");
    expect(body.get("redirect_uri")).toBe("https://cb/");

    spy.mockRestore();
  });

  test("returns error body from GitHub as-is", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad_verification_code" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await exchangeCode("cid", "csec", "bad", "https://cb/");
    expect(result).toEqual({ error: "bad_verification_code" });

    spy.mockRestore();
  });
});
