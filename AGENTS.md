# AGENTS.md

## Bun script runner and package manager

- `bun <file>`, not `node <file>` or `ts-node <file>`
- `bun install`, not `npm install` or `yarn install` or `pnpm install`
- `bun run <script>`, not `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- `bunx <package> <command>`, not `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Coding

- Group by use cases
- Main flows first, edge cases and error handling last
- Callers before called
- Tests mirror main file order

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
