import { describe, test, expect, vi } from 'vitest';

import { GithubOrgApi } from './api-org';

function orgApi(octokit: any, org = 'my-org'): GithubOrgApi {
  const o = new GithubOrgApi('t', org);
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

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
