# Desktop automatic updates

Status: implemented and end-to-end verified on macOS Apple Silicon, 2026-09-17 KST.

StateCarry uses Electrobun's stable-channel updater with GitHub Releases as the distribution source. The application checks for a newer release when the project workspace starts, lets the user download it explicitly, and applies the prepared update only after the user chooses to restart.

This document records the product and runtime contract. Release packaging and operator steps live in [desktop release](desktop-release.md).

## User flow

The normal flow is:

1. StateCarry starts and checks the stable update manifest, then checks again every six hours while the app remains open.
2. If the installed version is current, no rail action is shown. Settings shows the current app version at the bottom of the page.
3. If a newer release exists, the rail beside **Settings** shows **Download update**.
4. Download progress is shown while Electrobun prepares the update bundle.
5. When the bundle is ready, the rail shows **Restart**.
6. StateCarry stops its owned local runtime before handing the prepared update to Electrobun.
7. Electrobun replaces the application bundle and launches the new version.

StateCarry does not silently restart while the user is working. Checking is automatic; downloading and restarting are explicit user actions.

## Architecture

The updater stays behind the same local application boundary used by the rest of the desktop app.

| Layer                                             | Responsibility                                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/updater.ts`                     | Adapts Electrobun `Updater`, maps native states to StateCarry states, keeps raw diagnostics out of product copy, and initiates native apply. |
| `apps/desktop/src/main.ts`                        | Coordinates normal quit versus update restart. It stops the local runtime before calling the native updater.                                 |
| `apps/server/src/adapters/local-updater.ts`       | Defines the small local updater state and command contract.                                                                                  |
| `apps/server/src/http.ts`                         | Exposes loopback-only updater state/check/download/restart routes. Existing Host/Origin restrictions apply.                                  |
| `packages/presentation/src/project-controller.ts` | Starts and schedules automatic checks, manages download polling, and owns user-visible transient/error state.                                |
| `apps/web/src/ui/ProjectWorkspace.tsx`            | Renders the Settings rail update action and the current app version in Settings.                                                             |

The local HTTP routes are:

- `GET /api/v1/local/updater` — current updater state.
- `POST /api/v1/local/updater/check` — explicitly check for a newer release.
- `POST /api/v1/local/updater/download` — download and prepare the selected release.
- `POST /api/v1/local/updater/restart` — request an update restart after a bundle is ready.

They are local desktop integration routes, not a public network API. Browser/source-run environments that do not provide the desktop updater omit the feature.

## State model

StateCarry exposes these user-relevant phases:

| Phase         | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `idle`        | The installed version is current or no update action is active.               |
| `checking`    | StateCarry is checking the current stable release.                            |
| `available`   | A newer stable release is available.                                          |
| `downloading` | Electrobun is downloading or preparing an update bundle.                      |
| `ready`       | The update is prepared and can be applied after restart.                      |
| `restarting`  | StateCarry has accepted the restart request and is shutting down its runtime. |
| `error`       | The current check, download, or restart action did not complete.              |

Raw Electrobun messages, paths, URLs, stack traces, and provider diagnostics are not displayed as primary product errors. The adapter logs diagnostic detail locally and sends stable recovery copy to the UI.

## Shutdown and native handoff

StateCarry owns a loopback server, SQLite writer lock, and related local processes. A normal macOS quit therefore cannot immediately terminate the app: the `before-quit` handler first vetoes the initial quit, stops the runtime, and then exits.

Electrobun's update apply also asks `before-quit` handlers for approval before arming its native update helper. Calling it while the normal StateCarry veto is still active would cancel the update. The implemented sequence is therefore:

```text
Restart
  -> mark update restart requested
  -> request normal app quit
  -> before-quit vetoes immediate termination
  -> stop StateCarry runtime
  -> mark runtime stopped
  -> call Electrobun applyUpdate()
  -> updater receives quit approval without another StateCarry veto
  -> native helper replaces and relaunches the app
```

StateCarry treats Electrobun's `launching-new-version` status as evidence that the native handoff actually started. If apply throws or returns without that handoff signal, StateCarry falls back to a normal quit instead of leaving a window alive after its server has stopped.

## Release source and artifact contract

Stable builds read updates from:

```text
https://github.com/ThreeLightStudio/statecarry/releases/latest/download
```

Every update-capable release must publish all three artifacts with the Electrobun-generated names:

```text
macos-arm64-StateCarry.dmg
stable-macos-arm64-StateCarry.app.tar.zst
stable-macos-arm64-update.json
```

The manifest must identify the same application identifier, `stable` channel, target platform/architecture, release version, and update bundle filename.

GitHub's `releases/latest/download` follows the latest normal published release. A GitHub prerelease is therefore not a valid target for the current stable updater URL. Use a normal published release for versions intended to be discovered automatically, or change the distribution strategy before introducing a separate prerelease channel.

Delta patch generation is currently disabled in `electrobun.config.ts`. Updates use the full compressed application bundle. Enable delta patches only after the previous-release lookup and patch fallback path are deliberately tested; full-bundle fallback must remain valid.

## Versioning contract

For a desktop release, keep the application version synchronized in the locations that currently expose it:

- root `package.json`;
- `apps/desktop/src/app-version.ts`, which is consumed by `electrobun.config.ts` and injected into the web UI;
- the Codex RPC client metadata in `apps/server/src/adapters/rpc.ts`.

Workspace package versions are not used as the desktop update identity and do not need to change solely for a desktop patch release unless the repository adopts a different package-version policy.

## Verified rollout history

- `v0.1.0` established the signed/notarized stable release and GitHub artifact layout. It did not contain the StateCarry updater UI/bridge.
- `v0.1.1` introduced the desktop updater and is the bootstrap version for in-app updates.
- `v0.1.2` was published as a normal stable release and used to verify the updater end to end.

The controlled `v0.1.1 -> v0.1.2` verification observed all of the following:

1. the running `v0.1.1` app discovered `v0.1.2` as available;
2. the update bundle downloaded and reached the ready state;
3. restart/apply was accepted;
4. Electrobun's native result recorded `success: true` and `phase: complete` for `v0.1.2`;
5. the application bundle on disk reported the `v0.1.2` version/hash after replacement;
6. the updated app started again and reported itself current against the same stable release source.

The verification used an isolated application/data setup rather than user project records. Temporary local paths, transaction identifiers, account details, and signing identities are intentionally not recorded here.

## Tests

Focused updater coverage lives in:

- `tests/electrobun-updater.test.ts` — adapter state mapping and native handoff signal behavior;
- `tests/local-updater-http.test.ts` — local route method/origin/command behavior;
- `tests/project-updater-ui.test.tsx` — available -> download -> ready/restart UI flow.

Run focused coverage while editing update behavior, then run the repository verification contract before release:

```sh
rtk pnpm test tests/electrobun-updater.test.ts tests/local-updater-http.test.ts tests/project-updater-ui.test.tsx
rtk pnpm verify:fresh
```

The controlled release that introduced the updater passed 86 test files / 641 tests plus formatting, lint, TypeScript, boundary checks, and production builds. That result is release evidence for that source state, not a permanent test-count requirement.

### Isolation for native updater tests

Electrobun stable installs with the same application identifier/channel share managed state under the current macOS user account. Copying the app bundle to a temporary location is therefore not complete isolation by itself: bootstrap/update integration can still refresh shared install or uninstall metadata for that identifier/channel.

For future destructive/native end-to-end updater tests, prefer one of these boundaries:

- a disposable macOS user account or VM;
- a dedicated test application identifier/channel with its own release source;
- another environment whose managed application-support state is explicitly disposable.

Do not point a test release at real project data. If a same-identifier test is unavoidable, inspect and restore managed installation metadata afterward before treating the machine's normal installed app as release evidence.

## Privacy and diagnostics

Do not commit or publish:

- Apple account email addresses, Developer ID certificate owner names, Team IDs, or notary submission IDs;
- app-specific passwords, App Store Connect API keys, key paths, or Keychain export material;
- user home-directory names, private project paths, local databases, actual Codex conversations, or personal diagnostic logs;
- native updater transaction IDs or temporary update paths when they come from a real user's machine.

Public documentation should describe credential variable names and generic locations only. Release evidence should use public source commits/tags, artifact hashes when useful, and generic pass/fail results.
