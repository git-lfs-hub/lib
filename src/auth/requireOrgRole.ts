/**
 * HTTP guard: returns null when caller has the required org role, or a 403
 * Response otherwise. Structurally typed on `orgRole` to avoid importing
 * GithubApi (which would create a cycle with this package's github subpath).
 */
export async function requireOrgRole(
  api: { orgRole(org: string): Promise<"admin" | "member" | null> },
  org: string,
  role: "admin" | "member",
): Promise<Response | null> {
  const actual = await api.orgRole(org);
  const ok = role === "member" ? actual !== null : actual === "admin";
  const msg =
    role === "admin"
      ? "Forbidden: org admin required"
      : "Forbidden: org membership required";
  return ok ? null : new Response(msg, { status: 403 });
}
