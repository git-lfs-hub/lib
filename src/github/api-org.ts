import { GithubApi } from './api';
import { mapHttpError } from './errors';

/** One repo from a `scanRepos` sweep. `lfsconfig` null = file absent; `{ text: null }` = present
 *  but unreadable (binary/truncated, a parse fallback). `branch`/`headSha` null = empty repo. */
export type RepoScan = {
  owner: string;
  name: string;
  branch: string | null;
  headSha: string | null;
  lfsconfig: { oid: string; text: string | null } | null;
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
   * One GraphQL query per ~100 repos → presence + default-branch head + `.lfsconfig` inline, so a
   * full sweep is ~N/100 requests with no per-repo fetch. The installation token scopes the
   * listing to accessible repos. Throws GithubError on failure.
   */
  async *scanRepos(): AsyncIterable<RepoScan[]> {
    let cursor: string | null = null;
    try {
      do {
        const res: RepoScanQuery = await this.octokit.graphql(REPO_SCAN_QUERY, {
          login: this.org,
          cursor,
        });
        const remaining = res.rateLimit?.remaining;
        if (typeof remaining === 'number' && remaining < 500) {
          console.warn(`[github] low rate limit remaining=${remaining}`);
        }
        const conn = res.repositoryOwner?.repositories;
        if (!conn) return; // owner gone / not visible to this token
        yield conn.nodes.map(toRepoScan);
        cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
      } while (cursor);
    } catch (e) {
      throw mapHttpError(e, `GraphQL repositories for ${this.org}`);
    }
  }
}

type RepoNode = {
  name: string;
  owner: { login: string };
  defaultBranchRef: { name: string; target: { oid: string } | null } | null;
  object: { oid: string; text: string | null; isTruncated: boolean } | null;
};

type RepoScanQuery = {
  rateLimit: { remaining: number } | null;
  repositoryOwner: {
    repositories: {
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
      nodes: RepoNode[];
    };
  } | null;
};

function toRepoScan(n: RepoNode): RepoScan {
  const blob = n.object
    ? { oid: n.object.oid, text: n.object.isTruncated ? null : n.object.text }
    : null;
  return {
    owner: n.owner.login,
    name: n.name,
    branch: n.defaultBranchRef?.name ?? null,
    headSha: n.defaultBranchRef?.target?.oid ?? null,
    lfsconfig: blob,
  };
}

const REPO_SCAN_QUERY = `
  query ($login: String!, $cursor: String) {
    rateLimit { remaining }
    repositoryOwner(login: $login) {
      repositories(first: 100, after: $cursor) {
        pageInfo { endCursor hasNextPage }
        nodes {
          name
          owner { login }
          defaultBranchRef { name target { oid } }
          object(expression: "HEAD:.lfsconfig") {
            ... on Blob { oid text isTruncated }
          }
        }
      }
    }
  }
`;
