# Development and production isolation

The desktop and web clients share the same UI and relative API routes. Runtime
identity, local servers, data, and native update state are separate.

| Entry point             | API port                   | Data                | Native identity                            |
| ----------------------- | -------------------------- | ------------------- | ------------------------------------------ |
| Installed StateCarry    | OS-assigned, loopback only | `~/.statecarry`     | `com.threelightstudio.statecarry`, stable  |
| `pnpm desktop:dev`      | 4310                       | `~/.statecarry-dev` | `com.threelightstudio.statecarry.dev`, dev |
| `pnpm dev`              | 4310, web UI on 4311       | `~/.statecarry-dev` | None                                       |
| Built `dist/server.mjs` | OS-assigned, loopback only | `~/.statecarry`     | None                                       |

Development desktop and web use the same development profile. Run one development
API server at a time. They never attach to an already-running production server.
An occupied development port causes startup to fail rather than opening that server.

## Runtime selection

The desktop selects its runtime from the packaged channel and identifier, not the
shell environment. Only the stable production identifier selects production.
Source server runs select development; the standalone build injects production.

Production listens on `127.0.0.1:0`. After listening, the runtime reports the actual
assigned port and the desktop opens that address. Relative API URLs therefore stay
on the same server. Production rejects development Origin and Host headers. The
development server alone accepts the Vite origin; Vite rewrites Host to its API
target. `STATECARRY_PORT` configures the source server and Vite together.

Development uses its own database, writer lock, assets, settings, and analysis
cache. `STATECARRY_DATA_DIR` can override the development directory, but cannot
overlap `~/.statecarry`, including through existing symlinks. Production ignores
both development overrides. Existing production data is neither moved nor copied
into development. Development starts with an empty profile after this change.

## Browser-owned inputs

In desktop builds, the native preload restores `statecarry.*` browser preferences
and unsent drafts from `browser-state.json` in the runtime data directory before
the UI loads. Changes are saved through the same-origin local API. Quit requests
flush the latest snapshot before stopping the server; a closed or unresponsive
view has a bounded one-second grace period. The file is replaced atomically with
owner-only permissions. The native preload restores once per window session so a
page reload does not reset newer edits to the launch snapshot.

Existing browser-only drafts from the old fixed-port origin are not migrated.
Save any important unsent text before switching builds. Project records and
analysis in the production database are preserved. Standalone browser sessions
continue to use browser-origin storage; the native persistence bridge belongs to
the desktop app only.

## Native packaging and updates

Use the checked-in `desktop:build`, `desktop:dev`, `desktop:config`, and
`desktop:build:stable` / `desktop:config:stable` commands. They set the build profile
explicitly. An unspecified profile defaults to development; invalid profiles fail.

The macOS `postBuild` hook wraps the inner app's Electrobun launcher before
Electrobun hashes, signs, and archives that app. The shim creates a private
Cottontail temporary directory beneath the user's system temp directory, then
execs `launcher-electrobun` with its original working directory and arguments.
This puts the shim in both the DMG's embedded app archive and the standalone
update archive.

Electrobun creates the outer first-run bootstrap after archiving the inner app.
Its `Contents/MacOS/launcher` is the self-extractor, so the hook leaves that
bootstrap launcher unchanged. On first launch, the bootstrap extracts the
shimmed inner app, whose launcher keeps Cottontail run and worker files outside
the signed app bundle.

Development artifacts and web assets live beneath `.cache/electrobun/dev/`.
Production retains `.cache/electrobun/build`, `artifacts`, and `web`, so the release
runbook and public artifact names remain unchanged. Development has no update
source or updater bridge and uses its own native identifier.

A copied stable production bundle is still a production app. Do not execute stable
release smoke tests under the normal user profile; use the isolation described in
[automatic updates](auto-update.md#isolation-for-native-updater-tests).

## Validation

`runtime-isolation.test.ts` runs independent production and development servers,
checks profile separation, and rejects cross-environment HTTP requests.
`desktop-runtime-isolation.test.ts` checks native environment selection and the
assigned window URL. `desktop-browser-state.test.ts` checks preload restoration,
quit flushing, restart persistence, and rejection of development writes.
