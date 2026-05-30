import { describe, test, expect, vi, afterEach } from "vitest";
import { githubProxyFetch } from "./proxy";
import { USER_AGENT } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("githubProxyFetch", () => {
  test("injects User-Agent when no init headers given", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok"));
    await githubProxyFetch("https://github.com/x");
    const init = spy.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
  });

  test("merges User-Agent with caller headers", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok"));
    await githubProxyFetch("https://github.com/x", {
      headers: { Accept: "application/json" },
    });
    const headers = spy.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/json");
    expect(headers["User-Agent"]).toBe(USER_AGENT);
  });

  test("forwards only allow-listed response headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("body", {
        headers: {
          "Content-Type": "application/json",
          "X-OAuth-Scopes": "repo",
          "Set-Cookie": "secret=1",
          "X-RateLimit-Remaining": "42",
        },
      }),
    );
    const res = await githubProxyFetch("https://github.com/x");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("X-OAuth-Scopes")).toBe("repo");
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(res.headers.get("X-RateLimit-Remaining")).toBeNull();
    expect(await res.text()).toBe("body");
  });
});
