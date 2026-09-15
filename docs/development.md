# Development

StateCarry is a pnpm workspace. Run commands from the repository root with the Node and pnpm versions specified in `package.json`. RTK is required by the existing process adapters, development launcher and Git-based tests.

## Source layout

| Path | Responsibility |
| --- | --- |
| `apps/server` | Local HTTP server, SQLite storage, Codex access and operating-system adapters |
| `apps/web` | React interface, browser state and HTTP adapters |
| `packages/contracts` | Shared schemas and data contracts |
| `packages/core` | Work, evidence, analysis and continuation rules |
| `packages/presentation` | View models and interaction controllers |
| `tests` | Automated tests, synthetic records, temporary databases and fake providers |
| `scripts` | Development, boundary checks, production build, connection verification and local packaging |

UI code uses Presentation instead of importing Core or server adapters. Presentation and Core do not own browser or network access. `scripts/check-boundaries.ts` checks these boundaries; `vitest.config.ts` resolves the same workspace sources as TypeScript.

## Install and check

```sh
rtk pnpm install --frozen-lockfile
rtk pnpm check
rtk pnpm test
rtk pnpm build
```

The standard tests use fake providers and controlled temporary records. They do not require a Codex login, model calls or a personal database. Root test dependencies, including React and jsdom, are declared explicitly. Do not substitute dependencies from another development workspace.

`build` replaces generated `dist/` contents with the current server, connection helper and web build. Build metadata includes the dependency versions and lockfile hash. Generated output is ignored by Git.

For interactive development, run `rtk pnpm dev` and open `http://127.0.0.1:4311`. The development proxy expects the local server on port 4310. Starting the application uses the default private data directory unless `STATECARRY_DATA_DIR` is set. Use a separate empty directory for development experiments with controlled inputs.

## Connection verification

After building, `rtk proxy node dist/verify-connection.mjs --help` prints available commands without reading records or starting analysis. The read, provider preflight and navigation modes are explicit opt-in diagnostics. They can access the local Codex account or open an application; they are not part of the automated test suite.

Navigation verification uses an interactive terminal and the current user's confirmation. A successful OS dispatch alone is not arrival evidence. Existing evidence is preserved, including invalid evidence that needs investigation; do not distribute another user's navigation-verification file.

## Local packaging

The license and any required notices must be settled before distributing a package. `rtk pnpm package:local` requires `LICENSE` and copies the clean `dist/`, README, public docs, license and optional `NOTICE` into an ignored release directory. Run `build` first. Inspect the package and associate it with the source commit before publishing it; packaging does not validate the user's end-to-end resume experience.

The lockfile pins source dependencies; it does not replace their upstream licenses. Before a binary release, review the notices required for bundled dependencies and include them in the release. The root `private: true` prevents accidental npm publication and should remain enabled.

## Reporting and contributing

For a reproducible issue, include the source commit, Node version, operating system, expected behavior and a small synthetic example. Run the checks affected by a change. Keep fixes focused, retain meaningful regression tests and describe any remaining uncertainty.

Do not attach actual conversations, account credentials, private data directories or entire diagnostic logs. Replace session IDs, paths and prose with synthetic examples that reproduce the problem. Keep personal observations and research outputs outside the source tree or in ignored `.cache/` storage.

The source license is pending; contribution and redistribution terms must be confirmed before the public release. Current product work is tracked in [the roadmap](roadmap.md).
