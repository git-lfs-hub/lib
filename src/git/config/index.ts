/** Minimal git-config reader for fetched `.lfsconfig` / `.gitconfig` blobs — we parse the bytes in
 *  a Worker, so there's no git binary to shell out to. Returns the first value of `key` in the
 *  plain `[section]` (subsections `[section "x"]` are skipped), following git's value rules:
 *  `#`/`;` inline comments, surrounding/embedded double quotes, and `\` escapes. Null if absent. */
export function gitConfigFirstValue(text: string, section: string, key: string): string | null {
  const wantSection = `[${section.toLowerCase()}]`;
  const wantKey = key.toLowerCase();
  let inSection = false;
  for (const raw of text.split('\n')) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    if (line[0] === '[') {
      inSection = line.toLowerCase() === wantSection;
      continue;
    }
    if (!inSection) continue;
    const eq = line.indexOf('=');
    if (eq < 0 || line.slice(0, eq).trim().toLowerCase() !== wantKey) continue;
    return parseValue(line.slice(eq + 1));
  }
  return null;
}

/** Drop a `#`/`;` comment, but only outside a double-quoted span (and not when `\`-escaped). */
function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') i++; // escaped char can't open/close a quote or start a comment
    else if (c === '"') inQuote = !inQuote;
    else if (!inQuote && (c === '#' || c === ';')) return line.slice(0, i);
  }
  return line;
}

/** Unwrap a git-config value: strip surrounding/embedded double quotes and apply `\` escapes
 *  (`\n`/`\t` → control chars, `\"`/`\\`/other → the literal char). Leading whitespace is dropped;
 *  whitespace inside quotes is preserved. */
function parseValue(raw: string): string {
  const s = raw.replace(/^\s+/, '');
  let out = '';
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const n = s[++i];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
    } else if (c === '"') {
      inQuote = !inQuote;
    } else {
      out += c;
    }
  }
  return out;
}
