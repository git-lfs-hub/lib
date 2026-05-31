import { describe, test, expect } from "vitest";
import { Cache, type KvStore } from "./cache";

/** In-memory KV fake recording the last put options. */
function fakeKv() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; value: string; ttl?: number }> = [];
  const kv = {
    get: (key: string) => Promise.resolve(store.has(key) ? store.get(key)! : null),
    put: (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, value);
      puts.push({ key, value, ttl: opts?.expirationTtl });
      return Promise.resolve();
    },
  } as unknown as KvStore;
  return { kv, store, puts };
}

const SUFFIX = { ":user": 86400, ":access": 300 };

describe("getStr", () => {
  test("returns stored value", async () => {
    const { kv, store } = fakeKv();
    store.set("h:user", "alice");
    expect(await new Cache(kv, SUFFIX).getStr("h:user")).toBe("alice");
  });

  test("returns null on miss", async () => {
    const { kv } = fakeKv();
    expect(await new Cache(kv, SUFFIX).getStr("h:user")).toBeNull();
  });

  test("treats empty string as miss", async () => {
    const { kv, store } = fakeKv();
    store.set("h:user", "");
    expect(await new Cache(kv, SUFFIX).getStr("h:user")).toBeNull();
  });
});

describe("putStr", () => {
  test("writes with :user TTL", async () => {
    const { kv, puts } = fakeKv();
    await new Cache(kv, SUFFIX).putStr("h:user", "alice");
    expect(puts[0]).toEqual({ key: "h:user", value: "alice", ttl: 86400 });
  });

  test("writes with :access TTL", async () => {
    const { kv, puts } = fakeKv();
    await new Cache(kv, SUFFIX).putStr("alice:acme:access", "member");
    expect(puts[0]!.ttl).toBe(300);
  });

  test("first matching suffix wins", async () => {
    const { kv, puts } = fakeKv();
    await new Cache(kv, { "/hub:access": 999, ":access": 300 }).putStr(
      "alice:acme/hub:access",
      "write",
    );
    expect(puts[0]!.ttl).toBe(999);
  });

  test("throws when no suffix matches", async () => {
    const { kv } = fakeKv();
    await expect(new Cache(kv, SUFFIX).putStr("h:weird", "x")).rejects.toThrow(
      /no TTL suffix/,
    );
  });
});
