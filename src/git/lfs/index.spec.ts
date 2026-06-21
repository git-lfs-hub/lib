import { test, expect, describe } from 'vitest';

import {
  parseLfsConfig,
  parseLfsUrl,
  lfsPrefixFromPath,
  parseLfsPointer,
  lfsPatterns,
  matchesLfs,
} from './index';

describe('parseLfsConfig', () => {
  test('valid lfs.url → host + prefix', () => {
    const text = `[lfs]\n  url = https://lfs.git-lfs-hub.dev/lfs/Org/Repo`;
    expect(parseLfsConfig(text)).toEqual({
      host: 'lfs.git-lfs-hub.dev',
      prefix: 'Org/Repo',
      status: 'ok',
    });
  });

  test('no lfs.url → parse_error', () => {
    expect(parseLfsConfig('[core]\n  bare = false')).toEqual({
      host: '',
      prefix: '',
      status: 'parse_error',
    });
  });

  test('url present but path lacks owner/repo → parse_error, host kept', () => {
    expect(parseLfsConfig('[lfs]\n  url = https://lfs.git-lfs-hub.dev/lfs')).toMatchObject({
      host: 'lfs.git-lfs-hub.dev',
      prefix: '',
      status: 'parse_error',
    });
  });
});

describe('parseLfsUrl', () => {
  const hostOf = (url: string) => parseLfsUrl(url)!.host;

  test('splits host and path, lowercases host, keeps path case', () => {
    expect(parseLfsUrl('https://LFS.git-lfs-hub.dev/lfs/Org/Repo')).toEqual({
      host: 'lfs.git-lfs-hub.dev',
      path: '/lfs/Org/Repo',
    });
  });

  test('drops the scheme’s default port', () => {
    expect(hostOf('https://lfs.git-lfs-hub.dev:443/x')).toBe('lfs.git-lfs-hub.dev');
    expect(hostOf('http://lfs.git-lfs-hub.dev:80/x')).toBe('lfs.git-lfs-hub.dev');
  });

  test('keeps a non-default port', () => {
    expect(hostOf('http://localhost:8787/lfs/o/r')).toBe('localhost:8787');
  });

  test('null for non-http(s) scheme', () => {
    expect(parseLfsUrl('ssh://git@host/o/r')).toBeNull();
  });

  test('null for unparseable / relative url', () => {
    expect(parseLfsUrl('/lfs/o/r')).toBeNull();
    expect(parseLfsUrl('not a url')).toBeNull();
  });
});

describe('lfsPrefixFromPath', () => {
  test('strips the /lfs/ route and a trailing .git', () => {
    expect(lfsPrefixFromPath('/lfs/Org/Repo.git')).toBe('Org/Repo');
  });

  test('works without a leading /lfs/ segment', () => {
    expect(lfsPrefixFromPath('/o/r')).toBe('o/r');
  });

  test('null when fewer than owner/repo segments', () => {
    expect(lfsPrefixFromPath('/lfs/only')).toBeNull();
    expect(lfsPrefixFromPath('/')).toBeNull();
  });
});

describe('parseLfsPointer', () => {
  const POINTER = `version https://git-lfs.github.com/spec/v1
oid sha256:${'a'.repeat(64)}
size 12345
`;

  test('parses a v1 pointer → oid + size', () => {
    expect(parseLfsPointer(POINTER)).toEqual({ oid: 'a'.repeat(64), size: 12345 });
  });

  test('null without the v1 spec marker', () => {
    expect(parseLfsPointer(`oid sha256:${'a'.repeat(64)}\nsize 1`)).toBeNull();
  });

  test('null for a non-pointer blob', () => {
    expect(parseLfsPointer('just some file content\n')).toBeNull();
  });

  test('null when size is missing', () => {
    expect(
      parseLfsPointer(`version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}`),
    ).toBeNull();
  });
});

describe('lfsPatterns + matchesLfs', () => {
  const attrs = `# comment
*.bin filter=lfs diff=lfs merge=lfs -text
assets/**  filter=lfs
docs/*.png filter=lfs
*.txt text`;

  const patterns = lfsPatterns(attrs);

  test('basename glob matches at any depth', () => {
    expect(matchesLfs('a.bin', patterns)).toBe(true);
    expect(matchesLfs('deep/nested/a.bin', patterns)).toBe(true);
  });

  test('** crosses directories under an anchored prefix', () => {
    expect(matchesLfs('assets/img/logo.svg', patterns)).toBe(true);
  });

  test('anchored single-* does not cross /', () => {
    expect(matchesLfs('docs/a.png', patterns)).toBe(true);
    expect(matchesLfs('docs/sub/a.png', patterns)).toBe(false);
  });

  test('non-lfs attribute lines are ignored', () => {
    expect(matchesLfs('readme.txt', patterns)).toBe(false);
  });

  test('no gitattributes → nothing tracked', () => {
    expect(lfsPatterns(null)).toEqual([]);
    expect(matchesLfs('a.bin', [])).toBe(false);
  });

  test('leading slash anchors to repo root', () => {
    const p = lfsPatterns('/dir/root.bin filter=lfs');
    expect(matchesLfs('dir/root.bin', p)).toBe(true);
    expect(matchesLfs('sub/dir/root.bin', p)).toBe(false);
  });

  test('trailing slash is stripped (directory rule)', () => {
    const p = lfsPatterns('build/ filter=lfs');
    expect(matchesLfs('build', p)).toBe(true);
    expect(matchesLfs('nested/build', p)).toBe(true);
  });

  test('? matches exactly one non-slash char', () => {
    const p = lfsPatterns('file?.bin filter=lfs');
    expect(matchesLfs('fileA.bin', p)).toBe(true);
    expect(matchesLfs('file.bin', p)).toBe(false);
    expect(matchesLfs('fileAB.bin', p)).toBe(false);
  });
});
