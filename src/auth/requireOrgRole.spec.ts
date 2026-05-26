import { describe, test, expect } from "vitest";
import { requireOrgRole } from "./requireOrgRole";

function fakeApi(role: "admin" | "member" | null) {
  return { orgRole: async () => role };
}

describe("requireOrgRole", () => {
  test("admin role passes admin requirement", async () => {
    expect(await requireOrgRole(fakeApi("admin"), "org", "admin")).toBeNull();
  });

  test("member role fails admin requirement", async () => {
    const res = await requireOrgRole(fakeApi("member"), "org", "admin");
    expect(res?.status).toBe(403);
  });

  test("non-member fails admin requirement", async () => {
    const res = await requireOrgRole(fakeApi(null), "org", "admin");
    expect(res?.status).toBe(403);
  });

  test("admin role passes member requirement", async () => {
    expect(await requireOrgRole(fakeApi("admin"), "org", "member")).toBeNull();
  });

  test("member role passes member requirement", async () => {
    expect(await requireOrgRole(fakeApi("member"), "org", "member")).toBeNull();
  });

  test("non-member fails member requirement", async () => {
    const res = await requireOrgRole(fakeApi(null), "org", "member");
    expect(res?.status).toBe(403);
  });
});
