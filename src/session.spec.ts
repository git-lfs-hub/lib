import { describe, test, expect, vi } from "vitest";
import { encryptSession, decryptSession, validateSession, type SessionPayload } from "./session";

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

const PAYLOAD: SessionPayload = { token: "ghu_test_token" };

describe("encryptSession / decryptSession", () => {
  test("round-trip returns original payload", async () => {
    const token = await encryptSession(PAYLOAD, SECRET);
    expect(await decryptSession(token, SECRET)).toEqual(PAYLOAD);
  });

  test("preserves refresh_token when present", async () => {
    const p: SessionPayload = { token: "ghu_t", refresh_token: "ghr_r" };
    const token = await encryptSession(p, SECRET);
    expect(await decryptSession(token, SECRET)).toEqual(p);
  });

  test("each call produces a different ciphertext (random IV)", async () => {
    const a = await encryptSession(PAYLOAD, SECRET);
    const b = await encryptSession(PAYLOAD, SECRET);
    expect(a).not.toBe(b);
  });

  test("returns null for wrong secret", async () => {
    const token = await encryptSession(PAYLOAD, SECRET);
    expect(await decryptSession(token, OTHER_SECRET)).toBeNull();
  });

  test("returns null for expired token", async () => {
    const token = await encryptSession(PAYLOAD, SECRET, -1);
    expect(await decryptSession(token, SECRET)).toBeNull();
  });

  test("returns null for tampered ciphertext", async () => {
    const token = await encryptSession(PAYLOAD, SECRET);
    const parts = token.split(".");
    const c = parts[3];
    parts[3] = (c[0] === "A" ? "B" : "A") + c.slice(1);
    expect(await decryptSession(parts.join("."), SECRET)).toBeNull();
  });

  test("returns null for empty string", async () => {
    expect(await decryptSession("", SECRET)).toBeNull();
  });
});

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(),
}));

import { Octokit } from "@octokit/rest";
const MockOctokit = vi.mocked(Octokit);

function mockOctokit(impl: any) {
  MockOctokit.mockImplementationOnce(function () {
    return impl;
  } as any);
}

describe("validateSession", () => {
  test("returns null for undefined cookie", async () => {
    expect(await validateSession(undefined, SECRET)).toBeNull();
  });

  test("returns null for invalid cookie", async () => {
    expect(await validateSession("garbage", SECRET)).toBeNull();
  });

  test("returns session when GitHub API succeeds", async () => {
    const cookie = await encryptSession({ token: "ghu_valid" }, SECRET);
    mockOctokit({
      rest: {
        users: {
          getAuthenticated: () => Promise.resolve({ data: { login: "alice" } }),
        },
      },
    });

    const session = await validateSession(cookie, SECRET);
    expect(session).toEqual({ token: "ghu_valid", username: "alice" });
  });

  test("returns null when GitHub API rejects token", async () => {
    const cookie = await encryptSession({ token: "ghu_revoked" }, SECRET);
    mockOctokit({
      rest: {
        users: {
          getAuthenticated: () => Promise.reject(new Error("401")),
        },
      },
    });

    expect(await validateSession(cookie, SECRET)).toBeNull();
  });
});
