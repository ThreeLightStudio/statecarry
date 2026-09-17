# ADR 0001: Use Electrobun as the desktop host

- Status: Accepted
- Date: 2026-09-17
- Scope: macOS desktop delivery for StateCarry

## Context

StateCarry began as a web-based prototype and needs an installable local Mac application without losing the existing React workflow or loopback service contract. The desktop host must also support native file selection, controlled process shutdown, packaging, signing and automatic updates.

Before choosing Electrobun, the owner had evaluated Electron and Tauri while attempting to build a video editor:

- Tauri's client/Rust-server boundary required data conversion and transfer that did not meet the real-time needs of that architecture.
- Electron offered a broad ecosystem and wide support, but support for newer LTS stacks arrived slowly enough to cause dependency-related bugs. Even a relatively simple application could exceed 300 MB in installed size.

These observations are project experience and are scoped to the described video-editor architecture and measured application setup; they are not claims that either framework has the same limitation in every project.

## Decision

Use Electrobun as StateCarry's native macOS shell and distribution layer.

The decision is based on the following requirements:

1. Keep the existing TypeScript/React web prototype and HTTP/SSE server usable with limited additional implementation work.
2. Reduce desktop packaging overhead compared with the prior Electron experience.
3. Stay aligned with the TypeScript ecosystem and the existing pnpm workspace.
4. Provide native macOS packaging, directory selection and a supported automatic-update path.

Electrobun `2.0.1` is pinned in the existing workspace and uses Cottontail for the main process. The rest of the workspace and the StateCarry server remain Node/pnpm-based. The project will not migrate the workspace to Bun merely because the desktop shell is provided by a Bun-associated tool.

## Benefits

- Existing React UI and loopback API can be reused instead of maintaining a second native UI.
- TypeScript remains the primary application language and the existing workspace dependency model remains intact.
- The native host supplies directory selection, application lifecycle management, macOS packaging, signing/notarization and stable-channel updates.
- Electrobun's smaller distribution footprint addresses the size concern from the previous Electron experience.

## Trade-offs and consequences

- The current delivery target is macOS on Apple Silicon; other operating systems are outside this decision's scope.
- The desktop host and loopback server must coordinate startup, normal quit and update restart. A native updater cannot be treated as an independent process from StateCarry's runtime ownership rules.
- Finder-launched applications have a smaller environment than a development terminal, so discovery of Git, RTK, Codex and other supported executables needs explicit handling.
- Packaging and update verification do not establish real-world explanation quality, Codex analysis quality or human work-return acceptance.
- A shared web UI preserves compatibility, but desktop-only capabilities must remain behind explicit ports/adapters so browser/source-run behavior continues to work.

## Evidence

The choice has been exercised in the repository's desktop delivery work:

- [Tooling and desktop delivery plan](../tooling-and-desktop-plan.md) records the feasibility slice, Cottontail compatibility boundary, packaged asset reuse, runtime ownership, reduced-`PATH` executable discovery and final delivery scope.
- [Desktop automatic updates](../auto-update.md) records the updater state contract and the verified `v0.1.1 -> v0.1.2` shutdown, replacement and relaunch sequence.
- [Desktop release runbook](../desktop-release.md) records Developer ID signing, notarization, stapling, Gatekeeper assessment and release artifact requirements.

These records establish the tested packaging/update path on the supported environment. They do not claim independent second-machine validation or universal application behavior across all macOS configurations.

## Uncertainty and measurement policy

The often-mentioned “14 MB” figure is not treated as an established benchmark in this repository. The artifact being measured, compression/install condition, included runtime and measurement date are currently unspecified. If the figure is verified later, record it as a baseline with those conditions and compare it against the corresponding Electron/Tauri builds. Until then, describe Electrobun only as having a smaller observed or intended distribution footprint, without presenting 14 MB as a guaranteed size.

## Reconsideration triggers

Revisit this decision if any of the following becomes true:

- the supported product requires another operating system or architecture;
- Cottontail can no longer run the existing server reliably in packaged builds;
- native lifecycle/update behavior imposes unacceptable data-loss or recovery risk;
- the shared web UI can no longer meet product interaction or performance requirements;
- a measured alternative provides materially better compatibility at an acceptable operational and distribution cost.
