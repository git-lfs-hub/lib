import { afterEach, describe, expect, test, vi } from "vitest";
import { Hono } from "hono";
import { resolveSession } from "./resolve";
import {
  setSessionCookie,
  getSessionCookie,
  REFRESH_COOKIE,
  type SessionTokens,
} from "./session";

const SECRET = "a".repeat(64);
const OPTS = {
  secret: SECRET,
  clientId: "cid",
  clientSecret: "csec",
};

function mockFetchSequence(
  handlers: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>,
) {
  const spy = vi.spyOn(globalThis, "fetch");
  for (const handler of handlers) spy.mockImplementationOnce(handler as typeof fetch);
  return spy;
}

const githubUser = (login: string) => (_url: string) =>
  new Response(JSON.stringify({ login }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const githubUnauthorized = () => (_url: string) => new Response(null, { status: 401 });

const oauthRefresh = (body: Record<string, string>) => (url: string) => {
  expect(url).toBe("https://github.com/login/oauth/access_token");
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

/** App whose /set seeds a session cookie and /resolve runs resolveSession. */
function app() {
  const a = new Hono();
  a.get("/set", async (c) => {
    const tokens: SessionTokens = { access: "ghu_a", refresh: "ghr_old" };
    await setSessionCookie(c, tokens, SECRET);
    return c.text("ok");
  });
  a.get("/set-no-refresh", async (c) => {
    await setSessionCookie(c, { access: "ghu_a" }, SECRET);
    return c.text("ok");
  });
  a.get("/resolve", async (c) => {
    const session = await resolveSession(c, OPTS);
    return c.json(session ? { username: session.username } : null);
  });
  a.get("/get", async (c) => c.json(await getSessionCookie(c, SECRET)));
  return a;
}

function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function cookieFor(path: string): Promise<string> {
  return cookieHeader(await app().request(path));
}

describe("resolveSession", () => {
  afterEach(() => vi.restoreAllMocks());

  test("returns api + username for a valid cookie", async () => {
    const cookie = await cookieFor("/set");
    mockFetchSequence([githubUser("alice")]);
    const res = await app().request("/resolve", { headers: { Cookie: cookie } });
    expect(await res.json()).toEqual({ username: "alice" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("refreshes and re-sets the cookie when access token is stale", async () => {
    const cookie = await cookieFor("/set");
    mockFetchSequence([
      githubUnauthorized(),
      oauthRefresh({ access_token: "ghu_new", refresh_token: "ghr_new" }),
      githubUser("alice"),
    ]);
    const res = await app().request("/resolve", { headers: { Cookie: cookie } });
    expect(await res.json()).toEqual({ username: "alice" });
    expect(res.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test("keeps the prior refresh when GitHub omits a new one", async () => {
    const cookie = await cookieFor("/set");
    mockFetchSequence([
      githubUnauthorized(),
      oauthRefresh({ access_token: "ghu_new" }),
      githubUser("alice"),
    ]);
    const a = app();
    const res = await a.request("/resolve", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const reissued = cookieHeader(res);
    const getRes = await a.request("/get", { headers: { Cookie: reissued } });
    expect(await getRes.json()).toEqual({ access: "ghu_new", refresh: "ghr_old" });
  });

  test("returns null when no cookie present", async () => {
    const spy = mockFetchSequence([]);
    const res = await app().request("/resolve");
    expect(await res.json()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  test("returns null when refresh grant errors", async () => {
    const cookie = await cookieFor("/set");
    mockFetchSequence([githubUnauthorized(), oauthRefresh({ error: "bad_refresh" })]);
    const res = await app().request("/resolve", { headers: { Cookie: cookie } });
    expect(await res.json()).toBeNull();
  });

  test("returns null when the refreshed token is also unauthorized", async () => {
    const cookie = await cookieFor("/set");
    mockFetchSequence([
      githubUnauthorized(),
      oauthRefresh({ access_token: "ghu_new", refresh_token: "ghr_new" }),
      githubUnauthorized(),
    ]);
    const res = await app().request("/resolve", { headers: { Cookie: cookie } });
    expect(await res.json()).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test("refreshes from a refresh-only cookie when the access cookie is gone", async () => {
    const both = await app().request("/set");
    const refreshOnly = both.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!;
    mockFetchSequence([
      githubUnauthorized(),
      oauthRefresh({ access_token: "ghu_new", refresh_token: "ghr_new" }),
      githubUser("alice"),
    ]);
    const res = await app().request("/resolve", { headers: { Cookie: refreshOnly } });
    expect(await res.json()).toEqual({ username: "alice" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test("returns null when access is stale and there is no refresh", async () => {
    const cookie = await cookieFor("/set-no-refresh");
    mockFetchSequence([githubUnauthorized()]);
    const res = await app().request("/resolve", { headers: { Cookie: cookie } });
    expect(await res.json()).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
