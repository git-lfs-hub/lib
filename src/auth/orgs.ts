/** Org-list parsing. `GITHUB_ORGS` (plural) plus the legacy singular `GITHUB_ORG`. */

export function orgsFromEnv(env: { GITHUB_ORGS?: string; GITHUB_ORG?: string }): string[] {
  return [
    ...parseGithubList(env.GITHUB_ORGS),
    ...(env.GITHUB_ORG?.trim() ? [env.GITHUB_ORG.trim()] : []),
  ];
}

/** Splits a space/comma/semicolon-separated slug list; empty/undefined → []. */
export function parseGithubList(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(/[,;\s]+/).filter(Boolean);
}

/** `"src=target src2=target"` → lowercased pairs; entries missing a side are dropped. */
export function parseOrgsMap(s: string | undefined): [string, string][] {
  return parseGithubList(s)
    .map((entry) => entry.split('=').map((v) => v.trim().toLowerCase()))
    .filter((pair): pair is [string, string] => pair.length === 2 && !!pair[0] && !!pair[1]);
}

/** Slug list from a JSON var, where `vars.json` may spell it as a string or an array. */
export function orgList(v: string | string[] | undefined): string[] {
  return Array.isArray(v) ? v.filter(Boolean) : parseGithubList(v);
}
