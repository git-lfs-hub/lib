import { Octokit } from "@octokit/rest";
import { SignJWT, importPKCS8 } from "jose";
import type { GithubOrgApi } from "./api-org";

export const USER_AGENT = "git-lfs-hub";

export type RepoAccess = "read" | "write";

export class GithubApi {
  readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token, userAgent: USER_AGENT });
  }

  static async forApp(appId: string, appPrivateKey: string): Promise<GithubApi> {
    return new GithubApi(await signAppJwt(appId, appPrivateKey));
  }

  async authenticatedUsername(): Promise<string | null> {
    return this.octokit.rest.users
      .getAuthenticated()
      .then(({ data }) => data.login)
      .catch(() => null);
  }

  async orgRole(org: string): Promise<"admin" | "member" | null> {
    return this.octokit.rest.orgs
      .getMembershipForAuthenticatedUser({ org })
      .then(({ data }) => {
        if (data.state !== "active") return null;
        return data.role === "admin" ? "admin" : "member";
      })
      .catch(() => null);
  }

  async repoAccess(owner: string, repo: string): Promise<RepoAccess | null> {
    try {
      const { data } = await this.octokit.rest.repos.get({ owner, repo });
      return data.permissions?.push || data.permissions?.admin ? "write" : "read";
    } catch {
      return null;
    }
  }

  /**
   * Exchange the current (App JWT) client for an installation-authenticated
   * client scoped to `org`. Thin wrapper over `GithubOrgApi.forApp` — see that
   * factory for the GithubError contract.
   */
  async orgApi(org: string): Promise<GithubOrgApi> {
    const { GithubOrgApi } = await import("./api-org");
    return GithubOrgApi.forAppOrg(this, org);
  }
}

const APP_JWT_TTL_SECONDS = 600;
const CLOCK_SKEW_SECONDS = 30;

async function signAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(privateKeyPem, "RS256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(String(appId))
    .setIssuedAt(now - CLOCK_SKEW_SECONDS)
    .setExpirationTime(now + APP_JWT_TTL_SECONDS)
    .sign(key);
}
