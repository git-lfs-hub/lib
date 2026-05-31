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

### OAuth

- **`githubOAuthUrl(opts)`** → URL string — signs state and builds the `https://github.com/login/oauth/authorize` redirect URL.
- **`verifyState(token, secret)`** → `StatePayload | null` — verifies the signed state JWT from the callback.
- **`oauthCallback(opts)`** — exchanges the GitHub code; returns `encrypted` (session cookie), `tokenPayload`, and `statePayload`. Callers pass the result to `oauthSuccessUrl(result, secret)` to mint the loopback redirect, or to `oauthErrorUrl(result)` on failure.

### Session

- **`ACCESS_COOKIE`**, **`ACCESS_COOKIE_OPTIONS`**, **`SESSION_TTL`** — cookie name and options for `gh_session_v2`.
- **`encryptSession(payload, secret, ttl?)`** → JWE (AES-256-GCM) — session cookies and short-lived ephemeral codes.
- **`decryptSession(token, secret)`** → `SessionPayload | null`.

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
