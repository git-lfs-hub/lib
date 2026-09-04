import { generateKeyPair, exportPKCS8, jwtVerify } from 'jose';
import { describe, test, expect, vi, afterEach } from 'vitest';

import type { KvStore } from '../cache';
import { sha256hex } from '../crypto';
import { GithubApi } from './api';
import { GithubOrgApi } from './api-org';
import { GithubError, mapHttpError } from './errors';

function api(octokit: any, token = 't'): GithubApi {
  const a = new GithubApi(token);
  (a as { octokit: unknown }).octokit = octokit;
  return a;
}

/** In-memory KV fake. */
function fakeKv() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  const kv = {
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    put: (k: string, v: string, o?: { expirationTtl?: number }) => {
      store.set(k, v);
      ttls.set(k, o?.expirationTtl);
      return Promise.resolve();
    },
  } as unknown as KvStore;
  return { kv, store, ttls };
}

function cachedApi(octokit: any, kv: KvStore, token = 't'): GithubApi {
  const a = new GithubApi(token, kv);
  (a as { octokit: unknown }).octokit = octokit;
  return a;
}

describe('authenticatedUsername', () => {
  test('returns login when authenticated', async () => {
    const a = api({
      rest: {
        users: {
          getAuthenticated: () => Promise.resolve({ data: { login: 'alice' } }),
        },
      },
    });
    expect(await a.authenticatedUsername()).toBe('alice');
  });

  test('returns null on rejection', async () => {
    const a = api({
      rest: {
        users: {
          getAuthenticated: () => Promise.reject(new Error('401')),
        },
      },
    });
    expect(await a.authenticatedUsername()).toBeNull();
  });

  test('returns null for an App token without probing GET /user', async () => {
    const getAuthenticated = vi.fn();
    const a = api({ rest: { users: { getAuthenticated } } }, 'ghs_x');
    expect(await a.authenticatedUsername()).toBeNull();
    expect(getAuthenticated).not.toHaveBeenCalled();
  });
});

function membershipApi(impl: {
  state?: string;
  role?: 'admin' | 'member';
  reject?: number | boolean;
}) {
  return api({
    rest: {
      orgs: {
        getMembershipForAuthenticatedUser: () =>
          impl.reject
            ? Promise.reject(
                Object.assign(new Error(String(impl.reject)), {
                  status: impl.reject === true ? 404 : impl.reject,
                }),
              )
            : Promise.resolve({ data: { state: impl.state, role: impl.role } }),
      },
    },
  });
}

describe('orgRole', () => {
  test("returns 'admin' for active admin membership", async () => {
    expect(await membershipApi({ state: 'active', role: 'admin' }).orgRole('my-org')).toBe('admin');
  });

  test("returns 'member' for active member", async () => {
    expect(await membershipApi({ state: 'active', role: 'member' }).orgRole('my-org')).toBe(
      'member',
    );
  });

  test('returns null for pending membership', async () => {
    expect(await membershipApi({ state: 'pending', role: 'member' }).orgRole('my-org')).toBeNull();
  });

  test('returns null when API errors with 404', async () => {
    expect(await membershipApi({ reject: 404 }).orgRole('my-org')).toBeNull();
  });

  test('throws GithubError forbidden when API errors with 403', async () => {
    await expect(membershipApi({ reject: 403 }).orgRole('my-org')).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
  });
});

describe('callerAccess', () => {
  const PROJECTS = ['Acme'];
  afterEach(() => vi.unstubAllGlobals());

  test('a user token answers from the repo permissions, ignoring the projects orgs', async () => {
    expect(await repoApi({ push: true }).callerAccess('acme', 'hub', [])).toBe('write');
  });

  test("an App token that may push a projects-org repo gets 'write'", async () => {
    const { a } = pushApi();
    expect(await a.callerAccess('acme', 'hub', PROJECTS)).toBe('write');
  });

  test('org matching is case-insensitive', async () => {
    const { a } = pushApi();
    expect(await a.callerAccess('ACME', 'hub', ['acme'])).toBe('write');
  });

  test('any configured projects org matches', async () => {
    const { a } = pushApi({ full_name: 'second/hub' });
    expect(await a.callerAccess('acme', 'hub', ['acme', 'second'])).toBe('write');
  });

  test('an App token is denied for a repo outside every projects org', async () => {
    const { a } = pushApi({ full_name: 'other/hub' });
    expect(await a.callerAccess('other', 'hub', PROJECTS)).toBeNull();
  });

  test('a projects-org repo the token cannot push is denied', async () => {
    const { a } = pushApi({}, 403);
    expect(await a.callerAccess('acme', 'hub', PROJECTS)).toBeNull();
  });

  test('no projects orgs denies App tokens without asking GitHub', async () => {
    const { a, get } = pushApi();
    expect(await a.callerAccess('acme', 'hub', [])).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  test('a repo transferred out of the projects org is denied under its old namespace', async () => {
    const { a } = pushApi({ full_name: 'other/hub' });
    expect(await a.callerAccess('acme', 'hub', PROJECTS)).toBeNull();
  });

  test('omitting the projects orgs grants any repo the token may push', async () => {
    const { a } = pushApi({ full_name: 'platform/hub' });
    expect(await a.callerAccess('platform', 'hub')).toBe('write');
  });

  test('omitting them still denies a repo the token may not push', async () => {
    const { a } = pushApi({ full_name: 'platform/hub' }, 403);
    expect(await a.callerAccess('platform', 'hub')).toBeNull();
  });
});

function repoApi(
  permissions: { push?: boolean; admin?: boolean; pull?: boolean } | undefined | Error,
) {
  return api({
    rest: {
      repos: {
        get: () =>
          permissions instanceof Error
            ? Promise.reject(permissions)
            : Promise.resolve({ data: { permissions } }),
      },
    },
  });
}

describe('repoAccess', () => {
  test("returns 'write' when push permission", async () => {
    expect(await repoApi({ push: true, pull: true }).repoAccess('o', 'r')).toBe('write');
  });

  test("returns 'write' when admin permission", async () => {
    expect(await repoApi({ admin: true, push: false }).repoAccess('o', 'r')).toBe('write');
  });

  test("returns 'read' when only pull permission", async () => {
    expect(await repoApi({ pull: true, push: false, admin: false }).repoAccess('o', 'r')).toBe(
      'read',
    );
  });

  test("returns 'read' when permissions undefined", async () => {
    expect(await repoApi(undefined).repoAccess('o', 'r')).toBe('read');
  });

  test('returns null when repo lookup fails', async () => {
    expect(await repoApi(new Error('404')).repoAccess('o', 'r')).toBeNull();
  });
});

/** `repos.getContent` returning a base64 `.lfsconfig` blob, an error, or a directory listing. */
function fileApi(content: string | Error | unknown[], kv?: KvStore, encoding = 'base64') {
  const getContent = vi.fn(() => {
    if (content instanceof Error) return Promise.reject(content);
    if (Array.isArray(content)) return Promise.resolve({ data: content });
    const text = content as string;
    return Promise.resolve({
      data: { type: 'file', encoding, content: encoding === 'base64' ? btoa(text) : text },
    });
  });
  const octokit = { rest: { repos: { getContent } } };
  const a = kv ? cachedApi(octokit, kv) : api(octokit);
  return { a, getContent };
}

const LFSCONFIG = '[lfs]\n\turl = https://lfs.example.com/lfs/prod/hub\n';

describe('declaredLfsPrefix', () => {
  test('returns the declared prefix when the host matches', async () => {
    const { a } = fileApi(LFSCONFIG);
    expect(await a.declaredLfsPrefix('staging', 'hub', 'lfs.example.com')).toBe('prod/hub');
  });

  test('returns null when the config names another host', async () => {
    const { a } = fileApi(LFSCONFIG);
    expect(await a.declaredLfsPrefix('staging', 'hub', 'other.example.com')).toBeNull();
  });

  test('returns null when the file is absent', async () => {
    const { a } = fileApi(Object.assign(new Error('nope'), { status: 404 }));
    expect(await a.declaredLfsPrefix('staging', 'hub', 'lfs.example.com')).toBeNull();
  });

  test('returns null when the file has no lfs.url', async () => {
    const { a } = fileApi('[core]\n\tbare = true\n');
    expect(await a.declaredLfsPrefix('staging', 'hub', 'lfs.example.com')).toBeNull();
  });

  test('caches the parsed link under a token-independent key', async () => {
    const { kv, store } = fakeKv();
    const { a, getContent } = fileApi(LFSCONFIG, kv);
    await a.declaredLfsPrefix('Staging', 'Hub', 'lfs.example.com');
    await a.declaredLfsPrefix('Staging', 'Hub', 'lfs.example.com');
    expect(getContent).toHaveBeenCalledTimes(1);
    expect(store.get('staging/hub:lfsconfig')).toBe('lfs.example.com\tprod/hub');
  });

  test('caches the absence too, so a missing file is fetched once', async () => {
    const { kv, store } = fakeKv();
    const { a, getContent } = fileApi(Object.assign(new Error('nope'), { status: 404 }), kv);
    await a.declaredLfsPrefix('staging', 'hub', 'lfs.example.com');
    await a.declaredLfsPrefix('staging', 'hub', 'lfs.example.com');
    expect(getContent).toHaveBeenCalledTimes(1);
    expect(store.get('staging/hub:lfsconfig')).toBe('-');
  });
});

describe('repoFile', () => {
  test('decodes a base64 blob', async () => {
    const { a } = fileApi('hello');
    expect(await a.repoFile('o', 'r', '.lfsconfig')).toBe('hello');
  });

  test('returns null when the path is a directory', async () => {
    const { a } = fileApi([{ type: 'file' }]);
    expect(await a.repoFile('o', 'r', 'dir')).toBeNull();
  });

  test('returns null when the token cannot read the repo', async () => {
    const { a } = fileApi(Object.assign(new Error('forbidden'), { status: 403 }));
    expect(await a.repoFile('o', 'r', '.lfsconfig')).toBeNull();
  });

  test('passes through content that is not base64-encoded', async () => {
    const { a } = fileApi('plain', undefined, 'none');
    expect(await a.repoFile('o', 'r', '.lfsconfig')).toBe('plain');
  });

  test('throws on any other failure', async () => {
    const { a } = fileApi(Object.assign(new Error('boom'), { status: 500 }));
    await expect(a.repoFile('o', 'r', '.lfsconfig')).rejects.toThrow(GithubError);
  });

  test('throws when the failure is not an HTTP error', async () => {
    const { a } = fileApi(new Error('network down'));
    await expect(a.repoFile('o', 'r', '.lfsconfig')).rejects.toThrow(GithubError);
  });
});

/** `repos.get` plus a stubbed receive-pack advertisement — the App-token push probe. */
function pushApi(
  repo: { full_name?: string } | Error = {},
  advertised = 200,
  token = 'ghs_x',
  kv?: KvStore,
) {
  const get = vi.fn(() =>
    repo instanceof Error
      ? Promise.reject(repo)
      : Promise.resolve({ data: { full_name: 'acme/hub', ...repo } }),
  );
  const probe = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response('refs', { status: advertised })),
  );
  vi.stubGlobal('fetch', probe);
  const octokit = { rest: { repos: { get } } };
  const a = kv ? cachedApi(octokit, kv, token) : api(octokit, token);
  return { a, get, probe };
}

describe('appPushableRepo', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('a 200 advertisement means the token may push', async () => {
    const { a, probe } = pushApi();
    expect(await a.appPushableRepo('acme', 'hub')).toBe('acme/hub');
    expect(probe).toHaveBeenCalledWith(
      'https://github.com/acme/hub.git/info/refs?service=git-receive-pack',
      {
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa('x-access-token:ghs_x')}`,
        }),
      },
    );
  });

  test('probes where a transferred repo lives now, not the namespace asked for', async () => {
    const { a, probe } = pushApi({ full_name: 'projects/hub' });
    expect(await a.appPushableRepo('acme', 'hub')).toBe('projects/hub');
    expect(probe.mock.calls[0][0]).toContain('/projects/hub.git/');
  });

  test('403 means the token may not push, public repo included', async () => {
    const { a } = pushApi({ full_name: 'octocat/Hello-World' }, 403);
    expect(await a.appPushableRepo('octocat', 'Hello-World')).toBeNull();
  });

  test('404 means the repo is out of reach', async () => {
    const { a } = pushApi({}, 404);
    expect(await a.appPushableRepo('acme', 'hub')).toBeNull();
  });

  test('a 404 on the repo lookup denies without probing', async () => {
    const { a, probe } = pushApi(Object.assign(new Error('404'), { status: 404 }));
    expect(await a.appPushableRepo('acme', 'hub')).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  test('throws GithubError when the repo lookup fails for another reason', async () => {
    const { a } = pushApi(Object.assign(new Error('500'), { status: 500 }));
    await expect(a.appPushableRepo('acme', 'hub')).rejects.toMatchObject({
      code: 'transient',
      status: 500,
    });
  });

  test('throws GithubError on an unexpected advertisement status', async () => {
    const { a } = pushApi({}, 500);
    await expect(a.appPushableRepo('acme', 'hub')).rejects.toMatchObject({
      code: 'transient',
      status: 500,
    });
  });
});

describe('installedOrgs', () => {
  function pageIterator(pages: Array<{ data: any[] }>) {
    return async function* () {
      for (const p of pages) yield p;
    };
  }

  test('returns installed accounts (org and user), skips null accounts', async () => {
    const pages = [
      {
        data: [
          { id: 1, account: { login: 'Acme' } },
          { id: 2, account: null },
          { id: 3, account: { login: 'alice' } },
        ],
      },
    ];
    const a = api({
      paginate: { iterator: () => pageIterator(pages)() },
      rest: { apps: { listInstallations: vi.fn() } },
    });
    expect(await a.installedOrgs()).toEqual([
      { login: 'Acme', id: 1 },
      { login: 'alice', id: 3 },
    ]);
  });

  test('throws GithubError on listing failure', async () => {
    // eslint-disable-next-line require-yield -- async generator that only throws
    const failingIter = async function* () {
      throw Object.assign(new Error('403'), { status: 403 });
    };
    const a = api({
      paginate: { iterator: () => failingIter() },
      rest: { apps: { listInstallations: vi.fn() } },
    });
    await expect(a.installedOrgs()).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });
});

describe('orgApi', () => {
  test('mints an installation token → GithubOrgApi bound to the account', async () => {
    const a = api({
      rest: {
        apps: {
          createInstallationAccessToken: () => Promise.resolve({ data: { token: 'ghs_abc' } }),
        },
      },
    });
    const child = await a.orgApi({ login: 'my-org', id: 42 });
    expect(child).toBeInstanceOf(GithubOrgApi);
    expect(child.org).toBe('my-org');
  });

  test('throws unauthorized when App credentials rejected', async () => {
    const a = api({
      rest: {
        apps: {
          createInstallationAccessToken: () =>
            Promise.reject(Object.assign(new Error('401'), { status: 401 })),
        },
      },
    });
    await expect(a.orgApi({ login: 'my-org', id: 42 })).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    });
  });

  test('throws transient on token mint 5xx', async () => {
    const a = api({
      rest: {
        apps: {
          createInstallationAccessToken: () =>
            Promise.reject(Object.assign(new Error('500'), { status: 500 })),
        },
      },
    });
    await expect(a.orgApi({ login: 'my-org', id: 42 })).rejects.toMatchObject({
      code: 'transient',
      status: 500,
    });
  });
});

describe('cache', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('authenticatedUsername caches login; second call skips Octokit', async () => {
    const { kv } = fakeKv();
    const getAuthenticated = vi.fn(() => Promise.resolve({ data: { login: 'alice' } }));
    const a = cachedApi({ rest: { users: { getAuthenticated } } }, kv);
    expect(await a.authenticatedUsername()).toBe('alice');
    expect(await a.authenticatedUsername()).toBe('alice');
    expect(getAuthenticated).toHaveBeenCalledTimes(1);
  });

  test('failed auth is not cached', async () => {
    const { kv, store } = fakeKv();
    const a = cachedApi(
      { rest: { users: { getAuthenticated: () => Promise.reject(new Error('401')) } } },
      kv,
    );
    expect(await a.authenticatedUsername()).toBeNull();
    expect(store.size).toBe(0);
  });

  test('orgRole caches role; second call skips Octokit', async () => {
    const { kv } = fakeKv();
    const getMembershipForAuthenticatedUser = vi.fn(() =>
      Promise.resolve({ data: { state: 'active', role: 'member' } }),
    );
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated: () => Promise.resolve({ data: { login: 'alice' } }) },
          orgs: { getMembershipForAuthenticatedUser },
        },
      },
      kv,
    );
    expect(await a.orgRole('acme')).toBe('member');
    expect(await a.orgRole('acme')).toBe('member');
    expect(getMembershipForAuthenticatedUser).toHaveBeenCalledTimes(1);
  });

  test('inactive membership is not cached', async () => {
    const { kv, store } = fakeKv();
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated: () => Promise.resolve({ data: { login: 'alice' } }) },
          orgs: {
            getMembershipForAuthenticatedUser: () =>
              Promise.resolve({ data: { state: 'pending', role: 'member' } }),
          },
        },
      },
      kv,
    );
    expect(await a.orgRole('acme')).toBeNull();
    expect(store.has('alice:acme:access')).toBe(false);
  });

  test('the push proof is cached per repo, on its own suffix and TTL', async () => {
    const { kv, store, ttls } = fakeKv();
    const { a, get } = pushApi({}, 200, 'ghs_x', kv);
    expect(await a.callerAccess('acme', 'hub', ['acme'])).toBe('write');
    expect(await a.callerAccess('acme', 'hub', ['acme'])).toBe('write');
    expect(get).toHaveBeenCalledTimes(1);
    const key = `${await sha256hex('ghs_x')}:acme/hub:app-push`;
    expect(store.get(key)).toBe('acme/hub');
    expect(ttls.get(key)).toBe(3600);
  });

  test('an App caller that cannot push re-verifies rather than caching the denial', async () => {
    const { kv, store } = fakeKv();
    const { a, get } = pushApi({}, 403, 'ghs_x', kv);
    expect(await a.callerAccess('acme', 'hub', ['acme'])).toBeNull();
    expect(await a.callerAccess('acme', 'hub', ['acme'])).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
  });

  test('what is cached is the proof, so the projects-org gate still runs on a hit', async () => {
    const { kv } = fakeKv();
    const { a } = pushApi({ full_name: 'platform/hub' }, 200, 'ghs_x', kv);
    expect(await a.callerAccess('platform', 'hub')).toBe('write'); // LFS: no gate, fills the entry
    expect(await a.callerAccess('platform', 'hub', ['acme'])).toBeNull(); // submit: gate denies
  });

  test('the user path keeps its own suffix and TTL', async () => {
    const { kv, ttls } = fakeKv();
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated: () => Promise.resolve({ data: { login: 'alice' } }) },
          repos: { get: () => Promise.resolve({ data: { permissions: { push: true } } }) },
        },
      },
      kv,
    );
    await a.callerAccess('acme', 'hub', ['acme']);
    expect(ttls.get('alice:acme/hub:access')).toBe(300);
  });

  test('repoAccess caches access; second call skips Octokit', async () => {
    const { kv } = fakeKv();
    const get = vi.fn(() => Promise.resolve({ data: { permissions: { push: true } } }));
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated: () => Promise.resolve({ data: { login: 'alice' } }) },
          repos: { get },
        },
      },
      kv,
    );
    expect(await a.repoAccess('acme', 'hub')).toBe('write');
    expect(await a.repoAccess('acme', 'hub')).toBe('write');
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('no repo access is not cached', async () => {
    const { kv, store } = fakeKv();
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated: () => Promise.resolve({ data: { login: 'alice' } }) },
          repos: { get: () => Promise.reject(new Error('404')) },
        },
      },
      kv,
    );
    expect(await a.repoAccess('acme', 'hub')).toBeNull();
    expect(store.has('alice:acme/hub:access')).toBe(false);
  });

  test('App token keys the access cache by token hash', async () => {
    const { kv, store } = fakeKv();
    const get = vi.fn(() => Promise.resolve({ data: { permissions: { pull: true } } }));
    const a = cachedApi({ rest: { repos: { get } } }, kv, 'ghs_x');
    expect(await a.repoAccess('acme', 'hub')).toBe('read');
    expect(await a.repoAccess('acme', 'hub')).toBe('read');
    expect(get).toHaveBeenCalledTimes(1);
    expect(store.has(`${await sha256hex('ghs_x')}:acme/hub:app-push`)).toBe(true);
  });

  test('a user token whose login will not resolve still caches, keyed by token hash', async () => {
    const { kv, store } = fakeKv();
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated: () => Promise.reject(new Error('403')) },
          repos: { get: () => Promise.resolve({ data: { permissions: { push: true } } }) },
        },
      },
      kv,
      'ghp_x',
    );
    expect(await a.repoAccess('acme', 'hub')).toBe('write');
    expect(store.has(`${await sha256hex('ghp_x')}:acme/hub:access`)).toBe(true);
  });

  test('a narrower App token cannot read a broader one’s entry', async () => {
    const { kv } = fakeKv();
    const wide = cachedApi(
      {
        rest: { repos: { get: () => Promise.resolve({ data: { permissions: { push: true } } }) } },
      },
      kv,
      'ghs_wide',
    );
    const narrow = cachedApi(
      { rest: { repos: { get: () => Promise.reject(new Error('404')) } } },
      kv,
      'ghs_narrow',
    );
    expect(await wide.repoAccess('acme', 'hub')).toBe('write');
    expect(await narrow.repoAccess('acme', 'hub')).toBeNull();
  });

  test('username resolved once across orgRole and repoAccess', async () => {
    const { kv } = fakeKv();
    const getAuthenticated = vi.fn(() => Promise.resolve({ data: { login: 'alice' } }));
    const a = cachedApi(
      {
        rest: {
          users: { getAuthenticated },
          orgs: {
            getMembershipForAuthenticatedUser: () =>
              Promise.resolve({ data: { state: 'active', role: 'admin' } }),
          },
          repos: { get: () => Promise.resolve({ data: { permissions: { pull: true } } }) },
        },
      },
      kv,
    );
    await a.orgRole('acme');
    await a.repoAccess('acme', 'hub');
    expect(getAuthenticated).toHaveBeenCalledTimes(1);
  });
});

describe('constructor', () => {
  test('instantiates Octokit', () => {
    const a = new GithubApi('ghu_x');
    expect(a.octokit).toBeDefined();
  });
});

describe('GithubError', () => {
  test('carries code and status', () => {
    const e = new GithubError('forbidden', 'nope', 403);
    expect(e.code).toBe('forbidden');
    expect(e.status).toBe(403);
    expect(e.name).toBe('GithubError');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('mapHttpError', () => {
  test('maps a non-Error thrown value via String()', () => {
    const e = mapHttpError('boom', 'ctx');
    expect(e.code).toBe('transient');
    expect(e.message).toBe('boom');
    expect(e.status).toBeUndefined();
  });
});

describe('mintInstallationToken', () => {
  test('passes the scope through and returns the token', async () => {
    const createInstallationAccessToken = vi.fn(async () => ({ data: { token: 'scoped-tok' } }));
    const a = api({ rest: { apps: { createInstallationAccessToken } } });
    const token = await a.mintInstallationToken(42, {
      repositories: ['repoA'],
      permissions: { contents: 'write' },
    });
    expect(token).toBe('scoped-tok');
    expect(createInstallationAccessToken).toHaveBeenCalledWith({
      installation_id: 42,
      repositories: ['repoA'],
      permissions: { contents: 'write' },
    });
  });

  test('maps an API failure to GithubError', async () => {
    const a = api({
      rest: {
        apps: {
          createInstallationAccessToken: () => Promise.reject(new Error('boom')),
        },
      },
    });
    await expect(a.mintInstallationToken(1, {})).rejects.toBeInstanceOf(GithubError);
  });
});

describe('forApp', () => {
  test('signs an RS256 App JWT and builds an authenticated client', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', {
      extractable: true,
    });
    const pem = await exportPKCS8(privateKey);
    const a = await GithubApi.forApp('12345', pem);
    expect(a).toBeInstanceOf(GithubApi);

    const auth = await (a.octokit as { auth: () => Promise<{ token: string }> }).auth();
    const { payload, protectedHeader } = await jwtVerify(auth.token, publicKey);
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload.iss).toBe('12345');
    expect(payload.iat).toBeLessThan(payload.exp!);
  });
});
