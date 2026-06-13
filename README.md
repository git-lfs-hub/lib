# Git LFS Hub — lib

[![CI][ci-badge]][gh-wf-href]
[![Coverage][coverage-badge]][coverage-href]
[![CodeQL][codeql-badge]][codeql-href]
[![Socket][socket-badge]][socket-href]
[![License][license-badge]][license-href]

Shared authentication library for [Git LFS Hub](https://github.com/git-lfs-hub). Extracts the GitHub OAuth and session logic that was previously embedded in the server Worker into a package that the Worker and the admin GC UI both depend on.

For the bigger picture (what the stack does, the deploy flow, the other repos) see the [org overview](https://github.com/git-lfs-hub).

## Setup

This package is consumed by other workspaces in [git-lfs-hub/deploy](https://github.com/git-lfs-hub/deploy). You rarely need to work in this repo unless you are changing auth logic.

Install from the deploy root:

```sh
bun install
```

## API

Import from `@git-lfs-hub/lib/auth` (see `src/auth/index.ts`). Other entry points: `@git-lfs-hub/lib/github`.
Import from `@git-lfs-hub/lib/auth` (see `src/auth/index.ts`). Other entry points: `@git-lfs-hub/lib/github`, `@git-lfs-hub/lib/contracts`.

### OAuth

- **`githubOAuthUrl(opts)`** → URL string — signs state and builds the `https://github.com/login/oauth/authorize` redirect URL.
- **`verifyState(token, secret)`** → `OAuthState | null` — verifies the signed state JWT from the callback.
- **`oauthCallback(opts)`** → `OAuthCallbackResult` — exchanges the GitHub code. On success `{ ok: true, tokens, state }`; on failure `{ ok: false, error, state? }`. Callers pass `oauthSuccessUrl(tokens, state, secret)` to mint the loopback redirect, or `oauthErrorUrl(state, error)` on failure.

### Session

Tokens live in two independent cookies; `gh_session_v2` is read-only legacy, migrated on next write.

- **`ACCESS_COOKIE`** (`gh_access`, TTL **`ACCESS_TTL`** = 1d), **`REFRESH_COOKIE`** (`gh_refresh`, TTL **`REFRESH_TTL`** = 180d), **`LEGACY_COOKIE`** (`gh_session_v2`, read-only).
- **`setSessionCookie(c, tokens, secret)`** — writes the split access + refresh cookies, evicts the legacy monolith.
- **`getSessionCookie(c, secret)`** → `SessionTokens | null` — reads the split cookies, falling back to the legacy monolith.
- **`resolveSession(c, opts)`** → `{ api, username } | null` — resolves the GitHub identity, refreshing and re-setting cookies on an access-token miss.
- **`encryptSession(tokens, secret, ttl?)`** → JWE (AES-256-GCM) / **`decryptSession(token, secret)`** → `SessionTokens | null` — monolithic encode/decode for ephemeral OAuth codes and legacy cookies.

`SessionTokens` is `{ access: string; refresh?: string }` (the GitHub wire `access_token`/`refresh_token` names are kept only at the GitHub and CLI boundaries).

### Guards

- **`requireOrgRole(api, org, role)`** → `Response | null` — 403 when the user lacks the required org role; pass a `GithubApi` (or compatible `orgRole`).

## Key format

`secret` parameters are 64-character hex strings (32 bytes). The same format as `LOGIN_SECRET` in the Worker's `wrangler.jsonc`.

## Development

```sh
bun install
bun run test      # vitest (node environment)
```

[ci-badge]: https://badgen.net/github/checks/git-lfs-hub/lib/main?icon=vitest&label=CI
[gh-wf-href]: https://github.com/git-lfs-hub/lib/actions/workflows/main.yml?query=branch%3Amain
[coverage-badge]: https://badgen.net/https/git-lfs-hub.github.io/lib/coverage-badge.json?icon=vitest
[coverage-href]: https://git-lfs-hub.github.io/lib/lcov-report/
[codeql-badge]: https://github.com/git-lfs-hub/lib/actions/workflows/github-code-scanning/codeql/badge.svg
[codeql-href]: https://github.com/git-lfs-hub/lib/actions/workflows/github-code-scanning/codeql?query=branch%3Amain
[socket-badge]: https://badgen.net/static/Socket/report/blue?icon=socket
[socket-href]: https://socket.dev/dashboard/org/git-lfs-hub/repo/@git-lfs-hub/lib
[license-badge]: https://badgen.net/github/license/git-lfs-hub/lib
[license-href]: LICENSE.md
