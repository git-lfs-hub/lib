import { GithubApi } from './api';
import { isHttpError, mapHttpError } from './errors';

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
        const res: RepoScanQuery = await this.octokit.graphql(
          `query ($login: String!, $cursor: String) {
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
          }`,
          {
            login: this.org,
            cursor,
          },
        );
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

  /**
   * Fetch one file's blob — sha + decoded UTF-8 bytes — at a ref via the Contents API (one request
   * returns both). Null when the path is absent (404) or isn't a regular file; throws GithubError
   * on any other failure.
   */
  async getFile(
    repo: string,
    path: string,
    ref: string,
  ): Promise<{ sha: string; text: string } | null> {
    let data;
    try {
      ({ data } = await this.octokit.rest.repos.getContent({ owner: this.org, repo, path, ref }));
    } catch (e) {
      if (isHttpError(e) && e.status === 404) return null;
      throw mapHttpError(e, `GET ${this.org}/${repo}/${path}`);
    }
    if (Array.isArray(data) || data.type !== 'file') return null;
    const text = data.encoding === 'base64' ? decodeBase64Utf8(data.content) : data.content;
    return { sha: data.sha, text };
  }

  /**
   * Every `refs/heads/*` branch with its head commit sha and root `tree_sha`, in one GraphQL pass
   * (~N/100 requests; pages the `refs` connection for repos with >100 branches). `treeSha` is the
   * dedup key the resolver short-circuits on. `rateLimit` is the last page's meter, for cron backoff.
   * Throws GithubError on failure.
   */
  async listBranches(repo: string): Promise<{ branches: BranchHead[]; rateLimit: RateLimit }> {
    const branches: BranchHead[] = [];
    let rateLimit: RateLimit = null;
    let cursor: string | null = null;
    try {
      do {
        const res: BranchQuery = await this.octokit.graphql(
          `query ($owner: String!, $repo: String!, $cursor: String) {
            rateLimit { remaining resetAt }
            repository(owner: $owner, name: $repo) {
              refs(refPrefix: "refs/heads/", first: 100, after: $cursor) {
                pageInfo { endCursor hasNextPage }
                nodes {
                  name
                  target { oid ... on Commit { tree { oid } } }
                }
              }
            }
          }`,
          {
            owner: this.org,
            repo,
            cursor,
          },
        );
        rateLimit = res.rateLimit;
        const conn = res.repository?.refs;
        if (!conn) break; // repo gone / empty
        for (const n of conn.nodes) {
          const tree = n.target?.tree?.oid;
          if (n.target?.oid && tree)
            branches.push({ branch: n.name, headSha: n.target.oid, treeSha: tree });
        }
        cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
      } while (cursor);
    } catch (e) {
      throw mapHttpError(e, `GraphQL branches for ${this.org}/${repo}`);
    }
    return { branches, rateLimit };
  }

  /**
   * Recursive git tree at `treeSha` — every path with its blob/subtree sha — in one REST call.
   * `truncated` true means the listing was capped (≥100k entries / 7MB); the caller falls back to
   * per-subtree `getSubtree` descent (skipping cached subtree shas). Throws GithubError on failure.
   */
  async getTree(
    repo: string,
    treeSha: string,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    try {
      const args = { owner: this.org, repo, tree_sha: treeSha, recursive: '1' };
      const { data } = await this.octokit.rest.git.getTree(args);
      return { entries: toTreeEntries(data.tree), truncated: Boolean(data.truncated) };
    } catch (e) {
      throw mapHttpError(e, `getTree ${this.org}/${repo}@${treeSha}`);
    }
  }

  /** One level of a tree (non-recursive), for descending a truncated `getTree`. */
  async getSubtree(repo: string, treeSha: string): Promise<TreeEntry[]> {
    try {
      const args = { owner: this.org, repo, tree_sha: treeSha };
      const { data } = await this.octokit.rest.git.getTree(args);
      return toTreeEntries(data.tree);
    } catch (e) {
      throw mapHttpError(e, `getSubtree ${this.org}/${repo}@${treeSha}`);
    }
  }

  /** Every blob entry of a tree (full path + sha), descending a truncated `getTree` one subtree at
   *  a time. */
  async listBlobs(repo: string, treeSha: string): Promise<TreeEntry[]> {
    const { entries, truncated } = await this.getTree(repo, treeSha);
    if (!truncated) return entries.filter((e) => e.type === 'blob');
    const blobs: TreeEntry[] = [];
    const stack: { prefix: string; sha: string }[] = [{ prefix: '', sha: treeSha }];
    while (stack.length) {
      const { prefix, sha } = stack.pop()!;
      for (const e of await this.getSubtree(repo, sha)) {
        const path = prefix ? `${prefix}/${e.path}` : e.path;
        if (e.type === 'blob') blobs.push({ ...e, path });
        else if (e.type === 'tree') stack.push({ prefix: path, sha: e.sha });
      }
    }
    return blobs;
  }

  /**
   * Batch-fetch blob text by git blob sha via GraphQL aliases (~100/query) — the cold-scan pointer
   * fan-out. One query for thousands of blobs instead of N REST `getBlob`, preserving the REST
   * budget. A truncated/binary blob maps to `text: null`. Throws GithubError on failure.
   */
  async getBlobs(repo: string, oids: string[]): Promise<Map<string, { text: string | null }>> {
    const out = new Map<string, { text: string | null }>();
    for (let i = 0; i < oids.length; i += BLOB_BATCH) {
      const chunk = oids.slice(i, i + BLOB_BATCH);
      const aliases = chunk
        .map((oid, j) => `b${j}: object(oid: "${oid}") { ... on Blob { text isTruncated } }`)
        .join('\n');
      const query = `query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${aliases} } }`;
      let res: BlobQuery;
      try {
        res = await this.octokit.graphql(query, { owner: this.org, repo });
      } catch (e) {
        throw mapHttpError(e, `GraphQL blobs for ${this.org}/${repo}`);
      }
      chunk.forEach((oid, j) => {
        const blob = res.repository?.[`b${j}`];
        out.set(oid, { text: blob && !blob.isTruncated ? (blob.text ?? null) : null });
      });
    }
    return out;
  }

  /**
   * `compare(base...head)` — recovers a missed-middle-webhook gap without a tree read. `files` is
   * capped at 300 and `commits` at 250 by GitHub; a result at/over the cap can't be trusted complete,
   * so the caller treats `files.length >= 300` as untrustworthy. Throws GithubError on failure.
   */
  async compare(repo: string, base: string, head: string): Promise<CompareResult> {
    try {
      const { data } = await this.octokit.rest.repos.compareCommitsWithBasehead({
        owner: this.org,
        repo,
        basehead: `${base}...${head}`,
      });
      return {
        status: data.status as CompareResult['status'],
        files: (data.files ?? []).map((f) => ({ filename: f.filename, status: f.status })),
        totalCommits: data.total_commits,
      };
    } catch (e) {
      throw mapHttpError(e, `compare ${this.org}/${repo} ${base}...${head}`);
    }
  }
}

/** Decode the Contents API's base64 blob (newline-wrapped) into UTF-8 text. */
function decodeBase64Utf8(content: string): string {
  const bytes = Uint8Array.from(atob(content.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

/** A branch tip: head commit sha + root tree sha (the resolver's dedup key). */
export type BranchHead = { branch: string; headSha: string; treeSha: string };

/** One entry of a git tree listing. `commit` = a submodule gitlink (skipped by LFS detection).
 *  `size` is the git blob size (bytes) — for an LFS file that's the pointer size, not the real
 *  file; absent for `tree`/`commit`. */
export type TreeEntry = {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
};

export type CompareResult = {
  status: 'ahead' | 'behind' | 'identical' | 'diverged';
  files: { filename: string; status: string }[];
  totalCommits: number;
};

/** GraphQL rate-limit meter, for cron backoff. */
export type RateLimit = { remaining: number; resetAt: string } | null;

/** GraphQL blob aliases per query — the cold-scan fan-out batch size. */
const BLOB_BATCH = 100;

type BranchQuery = {
  rateLimit: RateLimit;
  repository: {
    refs: {
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
      nodes: { name: string; target: { oid: string; tree?: { oid: string } | null } | null }[];
    };
  } | null;
};

type BlobQuery = {
  repository: Record<string, { text: string | null; isTruncated: boolean } | undefined> | null;
};

function toTreeEntries(
  tree: { path?: string; type?: string; sha?: string; size?: number }[],
): TreeEntry[] {
  const out: TreeEntry[] = [];
  for (const e of tree) {
    if (!e.path || !e.sha) continue;
    if (e.type === 'blob' || e.type === 'tree' || e.type === 'commit')
      out.push({ path: e.path, type: e.type, sha: e.sha, size: e.size });
  }
  return out;
}
