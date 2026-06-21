import { gitConfigFirstValue } from '../config';

// Pure git-LFS parsing for blobs fetched in a Worker: `.lfsconfig` (lfs.url → storage prefix),
// LFS pointer blobs, and `.gitattributes` `filter=lfs` path rules.

export type LfsConfig = {
  host: string;
  prefix: string;
  status: 'ok' | 'parse_error';
};

/** Parse a `.lfsconfig` blob into its normalized host + storage prefix. Whether the host is this
 *  deployment (`local`) is left to the caller, which knows its own endpoint. */
export function parseLfsConfig(text: string): LfsConfig {
  const url = gitConfigFirstValue(text, 'lfs', 'url');
  const parsed = url ? parseLfsUrl(url) : null;
  const prefix = parsed ? lfsPrefixFromPath(parsed.path) : null;
  if (!parsed || !prefix) return { host: parsed?.host ?? '', prefix: '', status: 'parse_error' };
  return { host: parsed.host, prefix, status: 'ok' };
}

/** Parse an `lfs.url` into its normalized host (`host[:non-default-port]`, lowercased) and path.
 *  Null for a non-`http(s)` or unparseable URL. */
export function parseLfsUrl(url: string): { host: string; path: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return { host: u.host, path: u.pathname };
}

/** Storage prefix from an `lfs.url` path: the `owner/repo` after the `/lfs/` route, `.git`
 *  stripped. Mirrors the server's `resolveName()` candidate construction. */
export function lfsPrefixFromPath(path: string): string | null {
  const segs = path.split('/').filter(Boolean);
  if (segs[0] === 'lfs') segs.shift();
  if (segs.length < 2) return null;
  return `${segs[0]}/${segs[1].replace(/\.git$/, '')}`;
}

/** Parse an LFS pointer blob → its `oid`/`size`, or null when the bytes aren't a v1 pointer.
 *  Spec: a `version https://git-lfs.github.com/spec/v1` line, `oid sha256:<hex>`, `size <int>`. */
export function parseLfsPointer(text: string): { oid: string; size: number } | null {
  if (!text.includes('git-lfs.github.com/spec/v1')) return null;
  const oid = text.match(/^oid sha256:([0-9a-f]{64})$/m)?.[1];
  const size = text.match(/^size (\d+)$/m)?.[1];
  if (!oid || size === undefined) return null;
  return { oid, size: Number(size) };
}

/** Compile the `filter=lfs` path patterns from `.gitattributes` content into matchers. An empty list
 *  (no file, or no LFS rules) means nothing is LFS-tracked. */
export function lfsPatterns(gitattributes: string | null): LfsPattern[] {
  if (!gitattributes) return [];
  const patterns: LfsPattern[] = [];
  for (const raw of gitattributes.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...attrs] = line.split(/\s+/);
    if (attrs.includes('filter=lfs')) patterns.push(compile(pattern));
  }
  return patterns;
}

/** Does any compiled `filter=lfs` pattern match this path? */
export function matchesLfs(path: string, patterns: LfsPattern[]): boolean {
  const base = path.split('/').pop() ?? path;
  return patterns.some((p) => p.regex.test(p.basenameOnly ? base : path));
}

export type LfsPattern = { regex: RegExp; basenameOnly: boolean };

// Gitignore-style glob → anchored regex. A pattern with no `/` matches the basename at any depth;
// otherwise it's anchored at the repo root. `**` crosses `/`, `*`/`?` don't.
function compile(pattern: string): LfsPattern {
  let p = pattern;
  if (p.startsWith('/')) p = p.slice(1);
  if (p.endsWith('/')) p = p.slice(0, -1);
  const basenameOnly = !p.includes('/');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return { regex: new RegExp(`^${re}$`), basenameOnly };
}
