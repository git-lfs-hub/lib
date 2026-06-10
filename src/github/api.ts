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
};

export class GithubApi {
  readonly octokit: Octokit;
  private readonly token: string;
  private readonly cache?: Cache;
  private cachedUsername?: string;

  constructor(token: string, kv?: KvStore) {
    this.token = token;
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

  async authenticatedUsername(): Promise<string | null> {
    if (this.cachedUsername) return this.cachedUsername;
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

  /** Cache read → `fetch` on miss → cache write on success. */
  private async withCache<T extends string>(
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

  /** `{user}:{scope}:access` key, or `null` when the user is unknown. */
  private async accessKey(scope: string): Promise<string | null> {
    const user = await this.authenticatedUsername();
    return user ? `${user}:${scope}:access`.toLowerCase() : null;
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
