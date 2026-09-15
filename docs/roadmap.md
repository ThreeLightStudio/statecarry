# Roadmap

Status: development preview, 2026-09-15. Source cleanup, the initial local commit and stage 2A mechanical verification tooling are complete locally. Stage 2B now adds a pinned local-only Turborepo task graph over the existing pnpm workspace without changing the source-export package shape. Automated checks and source cleanup are separate from a completed product workflow. Electrobun remains later work.

The product goal is to help someone return to interrupted work, recognize the currently valid task, understand the necessary context and begin one useful action after the required confirmation.

## Release sequence

| Stage | Outcome                                           | Status / acceptance                                                                                                                                                                                                                                                                                                                            |
| ----- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Reproducible source tree and initial local commit | Complete at `7322042`. The reviewed source-only export passed installation, checks, 384 tests and build. This is historical evidence for that commit.                                                                                                                                                                                          |
| 2A    | Mechanical formatting and lint rules              | Complete locally: Oxfmt `0.68.0` + Oxlint `1.83.0`, existing TypeScript and boundary checks, one `verify` entry point and macOS CI are configured. A second format pass produced no diff; deliberate format, lint and boundary violations failed; a source-only frozen install and `verify` passed. Remote CI was not run in this local stage. |
| 2B    | Monorepo task execution                           | Complete locally: Turborepo `2.10.13` coordinates repository-wide cached checks and the combined `dist/` build over pnpm. Remote cache is disabled; runtime/tool fingerprints and relevant environment affect hashes; dev/fix/private runtime paths are not cached. Source-export packages remain unchanged.                                   |
| 2C    | Public release choices                            | Pending: license, required notices, repository owner/name and public commit attribution. Source installation was checked in stage 1; changes introduced in 2A/2B need their own evidence.                                                                                                                                                      |
| 3     | First public source release                       | Pending: publish the reviewed commit, then verify anonymous access, cloning and remote commit identity. Label it a development preview with the known product gaps.                                                                                                                                                                            |
| 4     | Work-specific state and action validity           | Pending: prevent cross-work draft saves, unrelated actions after goal/scope changes and indefinite rechecking caused by informational inspection limits.                                                                                                                                                                                       |
| 5     | Resume narrative and navigation lifecycle         | Pending: meaningful result/next-action copy, selection preservation, connection/URL consistency, same-connection restore and saved-result reload after server reconnection.                                                                                                                                                                    |
| 6     | Real work resumption and a later return           | Pending: observe the correct conversation, first useful action and subsequent result without repeating completed work. Distinguish model output, reports and independent checks.                                                                                                                                                               |
| 7A    | Installable macOS application                     | Planned: an Electrobun desktop host for the existing product. Implement after the core workflow is validated; check runtime, packaging and signing feasibility earlier.                                                                                                                                                                        |
| 7B    | MVP artifacts and submission                      | Pending: package the validated source commit, inspect contents/notices, verify the actual installation and submit only demonstrated capabilities.                                                                                                                                                                                              |

Stages 2A and 2B are bounded development-foundation work during public preparation. They must not expand into a package rewrite or an unrelated lint-remediation campaign that indefinitely delays the first public source release. Electrobun implementation is not a prerequisite for that source release. See [the tooling and desktop plan](tooling-and-desktop-plan.md) for boundaries and acceptance checks.

The earlier internal targets remain a product candidate on 2026-09-17 at 18:00 KST and submission preparation on 2026-09-18 at 12:00 KST. These are planning targets, not verified external deadlines or completed gates. An unfinished installer remains unfinished; do not report an existing source-run path as Electrobun installation success.

## Known gaps

The following were identified during development and remain outside the source-cleanup task:

- Switching work while editing a goal can mix draft state between works.
- Changing a goal when project inspection fails can leave an older candidate associated with the new goal.
- Limited project inspection can disable an otherwise current candidate's action and lead to repeated rechecks.
- Candidate selection, disconnect/restore, URL synchronization and server reconnection need further integrated verification.
- The resume body can repeat generic progress text without explaining the result that changed the next decision.

Existing automated tests do not establish that these gaps are resolved. A first public source release should retain this development status.

## Validation still needed

Use multiple goals, including different goals in the same folder and work spanning more than one conversation. Check work changes, edited drafts, refreshes, navigation away and back, restarts, disconnection and restoration. Separate time spent waiting for analysis from the user's understanding and first action.

Observe at least three complete real-work returns, including a subsequent return after the action's result arrives. A copied brief, accepted OS open request or synthetic-provider test alone is not a completed work return. A same-account clean directory check is also distinct from installation by another person or on another device.

This scope does not add automatic action execution, message submission, environment restoration, a general project manager or a new model-provider system. Electrobun adds application startup, shutdown and installation, not automatic execution of the proposed user task. Existing auxiliary context features remain available while the main resume flow is completed.
