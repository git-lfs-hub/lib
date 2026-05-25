import { Octokit } from "@octokit/rest";

export async function checkOrgRole(
  token: string,
  org: string,
): Promise<"admin" | "member" | null> {
  const octokit = new Octokit({ auth: token });
  return octokit.rest.orgs
    .getMembershipForAuthenticatedUser({ org })
    .then(({ data }) => {
      if (data.state !== "active") return null;
      return data.role === "admin" ? "admin" : "member";
    })
    .catch(() => null);
}
