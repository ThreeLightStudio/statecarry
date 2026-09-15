# Development

StateCarry is a pnpm workspace with Turborepo coordinating repository-wide checks and the combined build. Run commands from the repository root with the Node and pnpm versions specified in `package.json`. RTK is required by the existing process adapters, development launcher and Git-based tests.

## Source layout

| Path                    | Responsibility                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `apps/server`           | Local HTTP server, SQLite storage, Codex access and operating-system adapters               |
| `apps/web`              | React interface, browser state and HTTP adapters                                            |
| `packages/contracts`    | Shared schemas and data contracts                                                           |
| `packages/core`         | Work, evidence, analysis and continuation rules                                             |
| `packages/presentation` | View models and interaction controllers                                                     |
| `tests`                 | Automated tests, synthetic records, temporary databases and fake providers                  |
| `scripts`               | Development, boundary checks, production build, connection verification and local packaging |

UI code uses Presentation instead of importing Core or server adapters. Presentation and Core do not own browser or network access. `scripts/check-boundaries.ts` checks these boundaries; `vitest.config.ts` resolves the same workspace sources as TypeScript.

## Install and check

```sh
rtk pnpm install --frozen-lockfile
rtk pnpm verify
```

`verify` runs formatting, lint rules, TypeScript, architecture boundaries, tests and the combined `dist/` build in one Turbo graph; success means all six root tasks succeed. The artifact task waits for TypeScript but can otherwise run alongside independent checks. Turbo `2.10.13` is pinned exactly and caches eligible root tasks only on the local filesystem; remote caching is disabled in `turbo.json`. `verify:fresh` bypasses local cache reads and refreshes cache-safe results, which is the command to use when a release record needs proof that the checks actually executed.

The cached root tasks intentionally cover the whole tracked workspace while this project still has source-export packages and repository-wide tests. This makes changes under `apps/`, `packages/`, `tests/`, build/check scripts and shared configuration invalidate the affected cached result without inventing package-local build steps. The lockfile and package manifests remain pnpm-owned inputs. `.turbo/`, `dist/`, private state, local databases and other ignored/generated paths are not task inputs. Cache keys also include the actual OS release/architecture, Node, pnpm, RTK and Git versions observed by `scripts/run-turbo.ts`, plus relevant process environment such as `NODE_OPTIONS`; Vite-facing `VITE_*` values affect the build hash.

Vite can load local production `.env` files from `apps/web`. If one of those files exists, the Turbo wrapper disables cache reads and writes for that invocation instead of hashing private configuration. `format` and `lint:fix` remain direct writing commands, `dev` keeps the existing signal-aware launcher, and `start`, connection verification and local packaging remain direct runtime/diagnostic paths. These commands are not task-result cached.

`verify` does not run formatter or lint fixes. Use `rtk pnpm format` to normalize public files and `rtk pnpm lint:fix` only for Oxlint's safe fixes; the CLI's suggestion and dangerous-fix modes are intentionally not part of the script contract. The public `test` command remains a direct Vitest entry point so focused tests keep their existing argument forms, for example `rtk pnpm test tests/core.test.ts`. The full suite inside `verify` runs through the cached root `task:test` task.

The pinned tooling baseline is Oxfmt `0.68.0` and Oxlint `1.83.0`. Oxfmt leaves import order and `package.json` key order unchanged, does not format embedded code blocks/strings, collapses object literals when they fit to avoid preserve-mode multi-pass drift, and ignores private data, generated output, caches, dependencies and `pnpm-lock.yaml`. Oxlint disables category-wide defaults and enables only `no-debugger`, `no-duplicate-case`, `no-unreachable`, `typescript/no-extra-non-null-assertion`, `typescript/no-non-null-asserted-optional-chain`, `react/jsx-key` and `react/rules-of-hooks`. React `exhaustive-deps` is deliberately deferred because its findings require behavioral review rather than blind automatic edits. Type-aware linting is also deferred and is not implied by this configuration.

`rtk pnpm check` retains its previous contract by running both `typecheck` and `check:boundaries`. `rtk pnpm build` still type-checks when invoked by itself because the combined artifact task depends on the TypeScript root task. A single Turbo graph de-duplicates that dependency during `verify`, so the full TypeScript check and test suite are not repeated.

The standard tests use fake providers and controlled temporary records. They do not require a Codex login, model calls or a personal database. Root test dependencies, including React and jsdom, are declared explicitly. Do not substitute dependencies from another development workspace.

`build` replaces generated `dist/` contents with the current server, connection helper and web build. It is the only task that owns `dist/`, and Turbo caches that directory as one output. A cache hit restores the prior output without rerunning `scripts/build.ts`, including its initial `dist/` cleanup. Use `rtk pnpm verify:fresh` (or an explicitly fresh artifact build) before packaging or recording release evidence. Build metadata includes the dependency versions and lockfile hash. Its `builtAt` value is the artifact creation time; when Turbo restores a cached `dist/`, that timestamp is not a new verification time. Generated output is ignored by Git.

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

## Tooling and desktop work

Stage 2A installs Oxfmt/Oxlint and the shared verification contract described above. Stage 2B adds the pinned local-only Turborepo graph without splitting the existing source-export packages or combined build. CI uses macOS 15 on Apple Silicon with Node `24.14.1`, pnpm `10.33.2` and RTK `0.28.2`, performs a frozen install and runs the same `verify` command; it can populate only its runner-local cache because remote caching is disabled. The workflow configuration was checked locally, but no remote CI run is claimed for these stages. Electrobun installation is a later delivery milestone. See [the implementation and acceptance plan](tooling-and-desktop-plan.md).
