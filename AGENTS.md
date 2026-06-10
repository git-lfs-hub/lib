# AGENTS.md

## Bun script runner and package manager

- `bun <file>`, not `node <file>` or `ts-node <file>`
- `bun install`, not `npm install` or `yarn install` or `pnpm install`
- `bun run <script>`, not `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- `bunx <package> <command>`, not `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Coding

Order code in reading order of the main flow — not the order the compiler needs definitions.

- **Top-down: callers before callees.** Entry point / public export at the top; each
  helper appears *below* its first caller. Reading top-to-bottom, you meet each name in
  use before its definition.
  - Exception: "main" script entry point functions at the bottom
- **Main flow first; edge cases, helpers, and error handling last.** Happy path reads as
  a story up top; guards, fallbacks, and one-off helpers sink to the bottom.
- Make module-level helpers hoisted `function` declarations so the caller can precede
  them. Do NOT reorder to "definition before use": a `const fn = () => …` parked above its
  only caller is the wrong shape — make it a `function` and move it down.
- Group by use case. Tests mirror the main file's order.
- Keep comments brief. Focus on the "why" and the non-obvious.

## Testing

Use `vitest` to run tests.

```ts#index.test.ts
import { test, expect } from "vitest";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Commands

```bash
bun install         # install dependencies
vitest run          # run tests via vitest
```
