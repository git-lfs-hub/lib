import { GithubApi } from "./api";
import { GithubError, isHttpError, mapHttpError } from "./errors";

export type RestRepo = {
  owner: { login: string };
  name: string;
};

/** GithubApi bound to a single org via an installation token. */
export class GithubOrgApi extends GithubApi {
  readonly org: string;

  constructor(token: string, org: string) {
    super(token);
    this.org = org;
  }

  /**
   * Build an installation-authenticated client for `org` from an App-JWT
   * `app`. Throws GithubError:
   *   - code: "no_installation" — no installation for org
   *   - code: "unauthorized" | "forbidden" — App credentials rejected
   *   - code: "transient" — other failure
   */
  static async forAppOrg(app: GithubApi, org: string): Promise<GithubOrgApi> {
    let installation_id: number;
    try {
      const res = await app.octokit.rest.apps.getOrgInstallation({ org });
      installation_id = res.data.id;
    } catch (e) {
      if (isHttpError(e) && e.status === 404) {
        throw new GithubError(
          "no_installation",
          `no installation for org: ${org}`,
          404,
        );
      }
      throw mapHttpError(e, `getOrgInstallation for ${org}`);
    }
    try {
      const res = await app.octokit.rest.apps.createInstallationAccessToken({installation_id});
      const token = (res.data as { token: string }).token;
      return new GithubOrgApi(token, org);
    } catch (e) {
      throw mapHttpError(e, `createInstallationAccessToken for ${org}`);
    }
  }

  /**
   * Paginate `GET /orgs/{org}/repos`. Throws GithubError on failure.
   * Warns on low rate-limit remaining (< 100).
   */
  async *listRepos(): AsyncIterable<RestRepo[]> {
    const iter = this.octokit.paginate.iterator(
      this.octokit.rest.repos.listForOrg,
      { org: this.org, per_page: 100, type: "all" },
    );
    try {
      for await (const { data, headers } of iter) {
        const remaining = Number(headers["x-ratelimit-remaining"] ?? "");
        if (remaining > 0 && remaining < 100) {
          console.warn(`[github] low rate limit remaining=${remaining}`);
        }
        yield data as RestRepo[];
      }
    } catch (e) {
      throw mapHttpError(e, `GET /orgs/${this.org}/repos`);
    }
  }
}
