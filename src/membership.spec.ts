import { describe, test, expect, vi } from "vitest";

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(),
}));

import { Octokit } from "@octokit/rest";
import { checkOrgRole } from "./membership";

const MockOctokit = vi.mocked(Octokit);

function mockOctokit(impl: any) {
  MockOctokit.mockImplementationOnce(function () {
    return impl;
  } as any);
}

describe("checkOrgRole", () => {
  test("returns 'admin' for active admin membership", async () => {
    mockOctokit({
      rest: {
        orgs: {
          getMembershipForAuthenticatedUser: () =>
            Promise.resolve({ data: { state: "active", role: "admin" } }),
        },
      },
    });

    expect(await checkOrgRole("tok", "my-org")).toBe("admin");
  });

  test("returns 'member' for active member", async () => {
    mockOctokit({
      rest: {
        orgs: {
          getMembershipForAuthenticatedUser: () =>
            Promise.resolve({ data: { state: "active", role: "member" } }),
        },
      },
    });

    expect(await checkOrgRole("tok", "my-org")).toBe("member");
  });

  test("returns null for pending membership", async () => {
    mockOctokit({
      rest: {
        orgs: {
          getMembershipForAuthenticatedUser: () =>
            Promise.resolve({ data: { state: "pending", role: "member" } }),
        },
      },
    });

    expect(await checkOrgRole("tok", "my-org")).toBeNull();
  });

  test("returns null when API errors (not a member)", async () => {
    mockOctokit({
      rest: {
        orgs: {
          getMembershipForAuthenticatedUser: () =>
            Promise.reject(new Error("404")),
        },
      },
    });

    expect(await checkOrgRole("tok", "my-org")).toBeNull();
  });
});
