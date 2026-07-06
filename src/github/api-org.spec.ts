import { describe, test, expect, vi } from 'vitest';

import type { KvStore } from '../cache';
import { GithubOrgApi } from './api-org';

function orgApi(octokit: any, org = 'my-org'): GithubOrgApi {
  const o = new GithubOrgApi('t', org);
  (o as { octokit: unknown }).octokit = octokit;
  return o;
}

/** In-memory KV fake. */
function fakeKv() {
  const store = new Map<string, string>();
  const kv = {
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    put: (k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    },
  } as unknown as KvStore;
  return { kv, store };
}

function cachedOrgApi(octokit: any, kv: KvStore, org = 'my-org'): GithubOrgApi {
  const o = new GithubOrgApi('t', org, kv);
  (o as { octokit: unknown }).octokit = octokit;
  return o;
}

describe('scanRepos', () => {
  function node(name: string, over: Record<string, unknown> = {}) {
    return {
      name,
      owner: { login: 'Acme' },
      defaultBranchRef: { name: 'main', target: { oid: `head-${name}` } },
      object: null,
      ...over,
    };
  }
  function page(nodes: unknown[], hasNextPage = false, endCursor: string | null = null) {
    return {
      rateLimit: { remaining: 5000 },
      repositoryOwner: { repositories: { pageInfo: { endCursor, hasNextPage }, nodes } },
    };
  }

  test('paginates pages of repos with head + inline .lfsconfig', async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(page([node('alpha')], true, 'c1'))
      .mockResolvedValueOnce(
        page([node('beta', { object: { oid: 'b1', text: '[lfs]', isTruncated: false } })]),
      );
    const o = orgApi({ graphql });
    const collected = [];
    for await (const p of o.scanRepos()) collected.push(...p);
    expect(graphql.mock.calls[0][1]).toEqual({ login: 'my-org', cursor: null });
    expect(graphql.mock.calls[1][1]).toEqual({ login: 'my-org', cursor: 'c1' });
    expect(collected).toEqual([
      { owner: 'Acme', name: 'alpha', branch: 'main', headSha: 'head-alpha', lfsconfig: null },
      {
        owner: 'Acme',
        name: 'beta',
        branch: 'main',
        headSha: 'head-beta',
        lfsconfig: { oid: 'b1', text: '[lfs]' },
      },
    ]);
  });

  test('empty repo (no default branch) → null branch/headSha', async () => {
    const o = orgApi({
      graphql: vi.fn().mockResolvedValue(page([node('empty', { defaultBranchRef: null })])),
    });
    const [r] = (await collect(o.scanRepos()))[0];
    expect(r).toMatchObject({ branch: null, headSha: null });
  });

  test('truncated/binary blob → text null (parse fallback)', async () => {
    const o = orgApi({
      graphql: vi
        .fn()
        .mockResolvedValue(
          page([node('big', { object: { oid: 'b1', text: null, isTruncated: true } })]),
        ),
    });
    const [r] = (await collect(o.scanRepos()))[0];
    expect(r.lfsconfig).toEqual({ oid: 'b1', text: null });
  });

  test('owner not visible to the token → no pages', async () => {
    const o = orgApi({
      graphql: vi.fn().mockResolvedValue({ rateLimit: null, repositoryOwner: null }),
    });
    expect(await collect(o.scanRepos())).toEqual([]);
  });

  test('warns on low rate-limit remaining', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const o = orgApi({
      graphql: vi.fn().mockResolvedValue({
        rateLimit: { remaining: 100 },
        repositoryOwner: {
          repositories: { pageInfo: { endCursor: null, hasNextPage: false }, nodes: [] },
        },
      }),
    });
    await collect(o.scanRepos());
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('low rate limit'));
    spy.mockRestore();
  });

  test('maps a 403 to GithubError forbidden', async () => {
    const o = orgApi({
      graphql: vi.fn().mockRejectedValue(Object.assign(new Error('403'), { status: 403 })),
    });
    await expect(collect(o.scanRepos())).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  test('maps a non-HTTP throw to transient', async () => {
    const o = orgApi({ graphql: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(collect(o.scanRepos())).rejects.toMatchObject({ code: 'transient' });
  });
});

describe('getFile', () => {
  function fileApi(getContent: any) {
    return orgApi({ rest: { repos: { getContent } } });
  }

  test('decodes a base64 file blob → sha + text', async () => {
    const o = fileApi(
      vi.fn().mockResolvedValue({
        data: { type: 'file', sha: 'b1', content: btoa('[lfs]\n'), encoding: 'base64' },
      }),
    );
    expect(await o.getFile('repo', '.lfsconfig', 'c1')).toEqual({ sha: 'b1', text: '[lfs]\n' });
  });

  test('passes raw (non-base64) content through', async () => {
    const o = fileApi(
      vi.fn().mockResolvedValue({
        data: { type: 'file', sha: 'b1', content: 'plain', encoding: 'none' },
      }),
    );
    expect(await o.getFile('repo', '.lfsconfig', 'c1')).toEqual({ sha: 'b1', text: 'plain' });
  });

  test('404 → null', async () => {
    const o = fileApi(vi.fn().mockRejectedValue(Object.assign(new Error('404'), { status: 404 })));
    expect(await o.getFile('repo', '.lfsconfig', 'c1')).toBeNull();
  });

  test('a directory (array payload) → null', async () => {
    const o = fileApi(vi.fn().mockResolvedValue({ data: [{ type: 'file', name: 'a' }] }));
    expect(await o.getFile('repo', 'dir', 'c1')).toBeNull();
  });

  test('a non-file entry (submodule/symlink) → null', async () => {
    const o = fileApi(vi.fn().mockResolvedValue({ data: { type: 'submodule', sha: 'b1' } }));
    expect(await o.getFile('repo', '.gitmodules', 'c1')).toBeNull();
  });

  test('other errors → GithubError', async () => {
    const o = fileApi(vi.fn().mockRejectedValue(Object.assign(new Error('500'), { status: 500 })));
    await expect(o.getFile('repo', '.lfsconfig', 'c1')).rejects.toMatchObject({
      code: 'transient',
      status: 500,
    });
  });
});

describe('listBranches', () => {
  function refPage(nodes: unknown[], hasNextPage = false, endCursor: string | null = null) {
    return {
      rateLimit: { remaining: 4999, resetAt: '2026-01-01T00:00:00Z' },
      repository: { refs: { pageInfo: { endCursor, hasNextPage }, nodes } },
    };
  }
  const ref = (name: string, oid: string | null, tree: string | null) => ({
    name,
    target: oid ? { oid, tree: tree ? { oid: tree } : null } : null,
  });

  test('pages refs, returns head + tree sha, last rateLimit', async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(refPage([ref('main', 'h1', 't1')], true, 'c1'))
      .mockResolvedValueOnce(refPage([ref('dev', 'h2', 't2')]));
    const o = orgApi({ graphql });
    const res = await o.listBranches('repo');
    expect(graphql.mock.calls[1][1]).toEqual({ owner: 'my-org', repo: 'repo', cursor: 'c1' });
    expect(res.branches).toEqual([
      { branch: 'main', headSha: 'h1', treeSha: 't1' },
      { branch: 'dev', headSha: 'h2', treeSha: 't2' },
    ]);
    expect(res.rateLimit).toEqual({ remaining: 4999, resetAt: '2026-01-01T00:00:00Z' });
  });

  test('skips a tag/lightweight ref with no commit tree', async () => {
    const o = orgApi({ graphql: vi.fn().mockResolvedValue(refPage([ref('weird', 'h1', null)])) });
    expect((await o.listBranches('repo')).branches).toEqual([]);
  });

  test('empty/absent repo → no branches', async () => {
    const o = orgApi({ graphql: vi.fn().mockResolvedValue({ rateLimit: null, repository: null }) });
    expect((await o.listBranches('repo')).branches).toEqual([]);
  });

  test('maps a 403 to forbidden', async () => {
    const o = orgApi({
      graphql: vi.fn().mockRejectedValue(Object.assign(new Error('403'), { status: 403 })),
    });
    await expect(o.listBranches('repo')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('getTree', () => {
  function treeApi(getTree: any) {
    return orgApi({ rest: { git: { getTree } } });
  }

  test('maps blob/tree/commit entries, surfaces truncation', async () => {
    const o = treeApi(
      vi.fn().mockResolvedValue({
        data: {
          truncated: true,
          tree: [
            { path: 'a.bin', type: 'blob', sha: 'b1' },
            { path: 'sub', type: 'tree', sha: 't1' },
            { path: 'mod', type: 'commit', sha: 'c1' },
            { path: 'bad', type: 'blob' },
          ],
        },
      }),
    );
    expect(await o.getTree('repo', 'root')).toEqual({
      truncated: true,
      entries: [
        { path: 'a.bin', type: 'blob', sha: 'b1' },
        { path: 'sub', type: 'tree', sha: 't1' },
        { path: 'mod', type: 'commit', sha: 'c1' },
      ],
    });
  });

  test('recursive flag set on the request', async () => {
    const getTree = vi.fn().mockResolvedValue({ data: { truncated: false, tree: [] } });
    await treeApi(getTree).getTree('repo', 'root');
    expect(getTree.mock.calls[0][0]).toMatchObject({ tree_sha: 'root', recursive: '1' });
  });

  test('getSubtree omits the recursive flag', async () => {
    const getTree = vi.fn().mockResolvedValue({ data: { tree: [] } });
    await treeApi(getTree).getSubtree('repo', 'root');
    expect(getTree.mock.calls[0][0].recursive).toBeUndefined();
  });
});

describe('listBlobs', () => {
  test('untruncated tree → blob entries only, one call', async () => {
    const getTree = vi.fn().mockResolvedValue({
      data: {
        truncated: false,
        tree: [
          { path: 'a.bin', type: 'blob', sha: 'b1' },
          { path: 'sub', type: 'tree', sha: 't1' },
        ],
      },
    });
    const o = orgApi({ rest: { git: { getTree } } });
    expect(await o.listBlobs('repo', 'root')).toEqual([{ path: 'a.bin', type: 'blob', sha: 'b1' }]);
    expect(getTree).toHaveBeenCalledTimes(1);
  });

  test('truncated tree → per-subtree descent with joined paths', async () => {
    const getTree = vi.fn(async (args: any) => {
      if (args.recursive) return { data: { truncated: true, tree: [] } };
      if (args.tree_sha === 'root')
        return {
          data: {
            tree: [
              { path: '.gitattributes', type: 'blob', sha: 'ga' },
              { path: 'sub', type: 'tree', sha: 'tsub' },
            ],
          },
        };
      if (args.tree_sha === 'tsub')
        return { data: { tree: [{ path: 'a.bin', type: 'blob', sha: 'b1' }] } };
      return { data: { tree: [] } };
    });
    const o = orgApi({ rest: { git: { getTree } } });
    const blobs = await o.listBlobs('repo', 'root');
    expect(blobs.map((b) => b.path).sort()).toEqual(['.gitattributes', 'sub/a.bin']);
  });
});

describe('getBlobs', () => {
  test('batches aliases, maps text, null for truncated/missing', async () => {
    const graphql = vi.fn().mockResolvedValue({
      repository: {
        b0: { text: 'ptr', isTruncated: false },
        b1: { text: null, isTruncated: true },
      },
    });
    const o = orgApi({ graphql });
    const res = await o.getBlobs('repo', ['o0', 'o1']);
    expect(res.get('o0')).toEqual({ text: 'ptr' });
    expect(res.get('o1')).toEqual({ text: null });
    expect(graphql.mock.calls[0][0]).toContain('object(oid: "o0")');
  });

  test('chunks into separate queries past the batch size', async () => {
    const graphql = vi.fn().mockResolvedValue({ repository: {} });
    const oids = Array.from({ length: 150 }, (_, i) => `o${i}`);
    await orgApi({ graphql }).getBlobs('repo', oids);
    expect(graphql).toHaveBeenCalledTimes(2);
  });
});

describe('compare', () => {
  test('maps status, files, totalCommits', async () => {
    const o = orgApi({
      rest: {
        repos: {
          compareCommitsWithBasehead: vi.fn().mockResolvedValue({
            data: {
              status: 'ahead',
              total_commits: 2,
              files: [{ filename: 'a.bin', status: 'modified' }],
            },
          }),
        },
      },
    });
    expect(await o.compare('repo', 'b', 'h')).toEqual({
      status: 'ahead',
      totalCommits: 2,
      files: [{ filename: 'a.bin', status: 'modified' }],
    });
  });

  test('null files → empty list', async () => {
    const o = orgApi({
      rest: {
        repos: {
          compareCommitsWithBasehead: vi
            .fn()
            .mockResolvedValue({ data: { status: 'identical', total_commits: 0, files: null } }),
        },
      },
    });
    expect((await o.compare('repo', 'b', 'h')).files).toEqual([]);
  });
});

function membershipOrgApi(impl: { state?: string; role?: 'admin' | 'member'; reject?: number }) {
  return orgApi({
    rest: {
      orgs: {
        getMembershipForUser: () =>
          impl.reject
            ? Promise.reject(Object.assign(new Error(String(impl.reject)), { status: impl.reject }))
            : Promise.resolve({ data: { state: impl.state, role: impl.role } }),
      },
    },
  });
}

describe('orgMembership', () => {
  test("returns 'admin' for active admin", async () => {
    expect(await membershipOrgApi({ state: 'active', role: 'admin' }).orgMembership('bob')).toBe(
      'admin',
    );
  });

  test("returns 'member' for active member", async () => {
    expect(await membershipOrgApi({ state: 'active', role: 'member' }).orgMembership('bob')).toBe(
      'member',
    );
  });

  test('returns null for pending membership', async () => {
    expect(
      await membershipOrgApi({ state: 'pending', role: 'member' }).orgMembership('bob'),
    ).toBeNull();
  });

  test('returns null when API errors with 404', async () => {
    expect(await membershipOrgApi({ reject: 404 }).orgMembership('bob')).toBeNull();
  });

  test('throws GithubError forbidden when API errors with 403', async () => {
    await expect(membershipOrgApi({ reject: 403 }).orgMembership('bob')).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
  });

  test('caches role; second call skips Octokit', async () => {
    const { kv } = fakeKv();
    const getMembershipForUser = vi
      .fn()
      .mockResolvedValue({ data: { state: 'active', role: 'member' } });
    const o = cachedOrgApi({ rest: { orgs: { getMembershipForUser } } }, kv);
    expect(await o.orgMembership('bob')).toBe('member');
    expect(await o.orgMembership('bob')).toBe('member');
    expect(getMembershipForUser).toHaveBeenCalledTimes(1);
  });
});

function permOrgApi(perm: string | Error) {
  return orgApi({
    rest: {
      repos: {
        getCollaboratorPermissionLevel: () =>
          perm instanceof Error
            ? Promise.reject(perm)
            : Promise.resolve({ data: { permission: perm } }),
      },
    },
  });
}

describe('repoPermission', () => {
  test("returns 'write' for admin permission", async () => {
    expect(await permOrgApi('admin').repoPermission('hub', 'bob')).toBe('write');
  });

  test("returns 'write' for write permission", async () => {
    expect(await permOrgApi('write').repoPermission('hub', 'bob')).toBe('write');
  });

  test("returns 'read' for read permission", async () => {
    expect(await permOrgApi('read').repoPermission('hub', 'bob')).toBe('read');
  });

  test("returns null for 'none' permission", async () => {
    expect(await permOrgApi('none').repoPermission('hub', 'bob')).toBeNull();
  });

  test('returns null when API errors with 404', async () => {
    expect(
      await permOrgApi(Object.assign(new Error('404'), { status: 404 })).repoPermission(
        'hub',
        'bob',
      ),
    ).toBeNull();
  });

  test('throws GithubError forbidden when API errors with 403', async () => {
    await expect(
      permOrgApi(Object.assign(new Error('403'), { status: 403 })).repoPermission('hub', 'bob'),
    ).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  test('caches access; second call skips Octokit', async () => {
    const { kv } = fakeKv();
    const getCollaboratorPermissionLevel = vi
      .fn()
      .mockResolvedValue({ data: { permission: 'write' } });
    const o = cachedOrgApi({ rest: { repos: { getCollaboratorPermissionLevel } } }, kv);
    expect(await o.repoPermission('hub', 'bob')).toBe('write');
    expect(await o.repoPermission('hub', 'bob')).toBe('write');
    expect(getCollaboratorPermissionLevel).toHaveBeenCalledTimes(1);
  });
});

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
