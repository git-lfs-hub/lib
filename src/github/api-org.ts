import { GithubApi } from './api';
import { mapHttpError } from './errors';

export type RestRepo = {
  owner: { login: string };
  name: string;
};

/** GithubApi bound to a single installation (org or user account) via an installation token. */
export class GithubOrgApi extends GithubApi {
  readonly org: string;

  constructor(token: string, org: string) {
    super(token);
    this.org = org;
  }

  /**
   * Build an installation-authenticated client from an App-JWT `app` and a known
   * installation id (from `listInstallations`). Throws GithubError:
   *   - code: "unauthorized" | "forbidden" — App credentials rejected
   *   - code: "transient" — other failure
   */
  static async forInstallation(
    app: GithubApi,
    installationId: number,
    account: string,
  ): Promise<GithubOrgApi> {
    try {
      const res = await app.octokit.rest.apps.createInstallationAccessToken({
        installation_id: installationId,
      });
      const token = (res.data as { token: string }).token;
      return new GithubOrgApi(token, account);
    } catch (e) {
      throw mapHttpError(e, `createInstallationAccessToken for ${account}`);
    }
  }

  /**
   * Paginate `GET /installation/repositories` — every repo the installation can
   * reach (org or user account). Throws GithubError on failure. Warns on low
   * rate-limit remaining (< 100).
   */
  async *listRepos(): AsyncIterable<RestRepo[]> {
    const iter = this.octokit.paginate.iterator(
      this.octokit.rest.apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    );
    try {
      for await (const { data, headers } of iter) {
        const remaining = Number(headers['x-ratelimit-remaining'] ?? '');
        if (remaining > 0 && remaining < 100) {
          console.warn(`[github] low rate limit remaining=${remaining}`);
        }
        yield data as RestRepo[];
      }
    } catch (e) {
      throw mapHttpError(e, `GET /installation/repositories`);
    }
  }
}
