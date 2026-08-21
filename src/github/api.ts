import { Octokit } from '@octokit/rest';
import { SignJWT, importPKCS8 } from 'jose';

import { Cache, type KvStore } from '../cache';
import { sha256hex } from '../crypto';
import type { GithubOrgApi } from './api-org';
import { isHttpError, mapHttpError } from './errors';

export const USER_AGENT = 'git-lfs-hub';

export type RepoAccess = 'read' | 'write';

/** An account (org or user) the App is installed on. The installation id stays internal. */
type InstalledOrg = { login: string; id: number };

const CACHE_TTL = {
  ':user': 86400, // token -> user 1 day
  ':access': 300, // user -> access 5 min
  // Keyed by token hash, so a permission change mints a new token and misses. Only revocation
  // can go stale, bounded by an installation token's own life.
  ':app-push': 3600,
};

const APP_TOKEN_PREFIX = 'ghs_';

export class GithubApi {
  readonly octokit: Octokit;
  private readonly token: string;
  private readonly isAppToken: boolean;
  private readonly cache?: Cache;
  private cachedUsername?: string;

  constructor(token: string, kv?: KvStore) {
    this.token = token;
    this.isAppToken = token.startsWith(APP_TOKEN_PREFIX);
    this.cache = kv ? new Cache(kv, CACHE_TTL) : undefined;
    this.octokit = new Octokit({ auth: token, userAgent: USER_AGENT });
  }

  static async forApp(appId: string, appPrivateKey: string): Promise<GithubApi> {
    return new GithubApi(await signAppJwt(appId, appPrivateKey));
  }

  /**
   * Every account the App is installed on — the authoritative set of owners to
   * reconcile. Paginate `GET /app/installations` (App-JWT). User and org installs
   * alike; the caller treats each `login` as an owner.
   */
  async installedOrgs(): Promise<InstalledOrg[]> {
    const out: InstalledOrg[] = [];
    const iter = this.octokit.paginate.iterator(this.octokit.rest.apps.listInstallations, {
      per_page: 100,
    });
    try {
      for await (const { data } of iter) {
        for (const i of data as { id: number; account: { login: string } | null }[]) {
          if (i.account) out.push({ login: i.account.login, id: i.id });
        }
      }
    } catch (e) {
      throw mapHttpError(e, 'GET /app/installations');
    }
    return out;
  }

  /** Installation-authenticated client for an installed account (from `installedOrgs`). */
  async orgApi(org: InstalledOrg): Promise<GithubOrgApi> {
    // Dynamic import breaks the api ↔ api-org cycle.
    const { GithubOrgApi } = await import('./api-org');
    return GithubOrgApi.forInstallation(this, org.id, org.login);
  }

  /**
   * Narrowed below the installation grant, unlike `orgApi`/`forInstallation` — this bounds a
   * per-job token's blast radius. App-JWT client only. Throws GithubError.
   */
  async mintInstallationToken(
    installationId: number,
    scope: { repositories?: string[]; permissions?: Record<string, string> },
  ): Promise<string> {
    try {
      const res = await this.octokit.rest.apps.createInstallationAccessToken({
        installation_id: installationId,
        ...scope,
      });
      return (res.data as { token: string }).token;
    } catch (e) {
      throw mapHttpError(
        e,
        `createInstallationAccessToken (scoped) for installation ${installationId}`,
      );
    }
  }

  async authenticatedUsername(): Promise<string | null> {
    if (this.cachedUsername) return this.cachedUsername;
    // An App token has no user; `GET /user` 403s and `withCache` does not cache the null,
    // so probing would burn a request per call.
    if (this.isAppToken) return null;
    const login = await this.withCache(
      () => this.userKey(),
      () =>
        this.octokit.rest.users
          .getAuthenticated()
          .then(({ data }) => data.login)
          .catch(() => null),
    );
    if (login) this.cachedUsername = login;
    return login;
  }

  /**
   * Active org membership role for the authenticated user, or `null` when the
   * user is not an active member. Throws GithubError on API failure (e.g.
   * `forbidden` when the token cannot read org membership).
   */
  async orgRole(org: string): Promise<'admin' | 'member' | null> {
    return this.withCache(
      () => this.accessKey(org),
      async () => {
        try {
          const { data } = await this.octokit.rest.orgs.getMembershipForAuthenticatedUser({ org });
          if (data.state !== 'active') return null;
          return data.role === 'admin' ? 'admin' : 'member';
        } catch (e) {
          if (isHttpError(e) && e.status === 404) return null;
          throw mapHttpError(e, `getMembershipForAuthenticatedUser for ${org}`);
        }
      },
    );
  }

  /**
   * `projectsOrgs` confines App callers to repos in those orgs — pass it where the grant makes
   * *another* principal push (a submit hands the job to the fleet), `[]` to reject App callers,
   * omit it where the caller pushes its own bytes (LFS).
   */
  async callerAccess(
    owner: string,
    repo: string,
    projectsOrgs?: string[],
  ): Promise<RepoAccess | null> {
    if (!this.isAppToken) return this.repoAccess(owner, repo);
    if (projectsOrgs && !projectsOrgs.length) return null;
    // Cache the push proof — a GitHub fact — never the gated verdict: lfs-server and lfs-compute
    // share one KV namespace, so an ungated verdict would be read by the caller that needs the gate.
    const pushable = await this.withCache(
      () => this.accessKey(`${owner}/${repo}`),
      () => this.appPushableRepo(owner, repo),
    );
    if (!pushable) return null;
    if (!projectsOrgs) return 'write';
    const found = pushable.split('/')[0].toLowerCase();
    return projectsOrgs.some((org) => org.toLowerCase() === found) ? 'write' : null;
  }

  async repoAccess(owner: string, repo: string): Promise<RepoAccess | null> {
    return this.withCache(
      () => this.accessKey(`${owner}/${repo}`),
      () =>
        this.octokit.rest.repos
          .get({ owner, repo })
          .then(({ data }) =>
            data.permissions?.push || data.permissions?.admin ? 'write' : 'read',
          )
          .catch(() => null),
    );
  }

  /**
   * An installation token cannot convey its level over REST (`permissions` comes back all-false),
   * but the receive-pack advertisement answers about push directly and writes nothing. Returns the
   * repo's current `owner/repo` — a moved repo keeps its `.lfsconfig`, so the caller's segments
   * are a routing key.
   */
  async appPushableRepo(owner: string, repo: string): Promise<string | null> {
    let fullName: string;
    try {
      fullName = (await this.octokit.rest.repos.get({ owner, repo })).data.full_name;
    } catch (e) {
      if (isHttpError(e) && e.status === 404) return null;
      throw mapHttpError(e, `repos.get for ${owner}/${repo}`);
    }
    const res = await fetch(
      `https://github.com/${fullName}.git/info/refs?service=git-receive-pack`,
      {
        headers: {
          Authorization: `Basic ${btoa(`x-access-token:${this.token}`)}`,
          'User-Agent': USER_AGENT,
        },
      },
    );
    // The body is the whole ref advertisement — push has no protocol-v2 slim form.
    await res.body?.cancel();
    if (res.status === 200) return fullName;
    if (res.status === 403 || res.status === 404) return null;
    throw mapHttpError({ status: res.status, message: '' }, `receive-pack for ${fullName}`);
  }

  /** Cache read → `fetch` on miss → cache write on success. */
  protected async withCache<T extends string>(
    keyFn: () => Promise<string | null>,
    fetch: () => Promise<T | null>,
  ): Promise<T | null> {
    const key = this.cache ? await keyFn() : null;
    if (key) {
      const hit = await this.cache!.getStr(key);
      if (hit) return hit as T;
    }
    const value = await fetch();
    if (value && key) await this.cache!.putStr(key, value);
    return value;
  }

  /** `{hash}:user` key (SHA-256 of token, hex). */
  private async userKey(): Promise<string> {
    return `${await sha256hex(this.token)}:user`;
  }

  /**
   * Never the App/installation id: a narrowly scoped token must not read a broader one's entry.
   * The App bucket has its own suffix so its TTL tunes apart from the user path's.
   */
  private async accessKey(scope: string): Promise<string> {
    if (this.isAppToken) return `${await sha256hex(this.token)}:${scope}:app-push`.toLowerCase();
    const user = await this.authenticatedUsername();
    const principal = user ?? (await sha256hex(this.token));
    return `${principal}:${scope}:access`.toLowerCase();
  }
}

const APP_JWT_TTL_SECONDS = 600;
const CLOCK_SKEW_SECONDS = 30;

async function signAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(privateKeyPem, 'RS256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(String(appId))
    .setIssuedAt(now - CLOCK_SKEW_SECONDS)
    .setExpirationTime(now + APP_JWT_TTL_SECONDS)
    .sign(key);
}
