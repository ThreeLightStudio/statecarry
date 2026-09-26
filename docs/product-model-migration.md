# Public Beta native project model

Implementation baseline: database version 4, 2026-09-27. The application reads only the native
project model. The startup cutover in `apps/server/src/adapters/beta-cutover.ts` performs the
one-time public beta project-data reset for supported database versions 1, 2, and 3.

## Ownership

| Responsibility                                       | Canonical owner                               |
| ---------------------------------------------------- | --------------------------------------------- |
| Registration, identity, focus, folder and connection | `ProjectRecord`, `Connection`                 |
| Observed project state                               | `ProjectObservation`                          |
| Generated overview and proposals                     | `ProjectAnalysisRecord`, `WorkProposalRecord` |
| Overview corrections                                 | `ProjectAnalysisControl`                      |
| Direction                                            | `Direction`                                   |
| Confirmed tasks, relationships and choices           | `WorkItem`, `WorkRelation`, `WorkDecision`    |
| Return checkpoints and task discussions              | `ReturnPoint`, `WorkDiscussionRecord`         |
| Change scopes, kept changes and policy conflict      | `ProjectScopeRecord`                          |
| Requests, comparison and acceptance                  | `ProjectExecutionRecord`, `Continuation`      |
| Delivery policy and release progress                 | Release domain records                        |

Project identity is `projectId`; a confirmed task is identified by `workItemId`. Generated proposals
remain readable choices until selected. Selecting one creates or links a durable task. Reanalysis
and response-language changes replace generated content without rewriting the selected task or user
choices. Analysis readiness is independent of whether any task has been selected.

`ProjectNow` resolves the current task and next action. Presentation renders that resolution. Scope
review and execution/result review are entered deliberately through `ProjectNowAction`; preparing a
request does not send it, and a successful execution report does not accept its result. Task execution
requires a task ID. Direction and policy requests belong directly to the project.

## API and browser state

All project operations use `/api/v1/projects`: registrations, ProjectNow, initialization, workspace,
analysis, work commands, evidence, discussions, execution and releases. The old `/resume`,
`/work-contexts` and `/project-workspace` routes have no aliases. Required gateway capabilities are
part of the client contract. Initialization/connection failure is an explicit retryable error.

Task discussions are persisted on the server by `workItemId`, including tasks written by the user
without a generated proposal. Browsers store only unsent input and transient view state under
`statecarry.project-drafts.v3.` and `statecarry.project-action.v3.`. Old application draft namespaces
are removed. Project response-language preferences reset with the project registration. No
browser-selected work or saved answer is imported into the native model.

## One-time public beta project-data reset

SQLite initialization performs the reset before ordinary reads and background work. Fresh
installations start at version 4. Existing versions 1, 2, and 3 go directly to version 4 without
running the former version 1-to-2 cleanup.

The next beta update clears all StateCarry project registrations and project-owned records,
including analyses, observations, direction, work, discussions, execution state, and copied source
content. It also removes StateCarry-owned analysis caches, logs, and copied project images. Users
register their projects again after the update. The app-wide analysis provider and its credentials,
the appearance theme, original project files and Git metadata, and external Codex conversations are
preserved. The reset runs once; new registrations and project data are retained on later starts.

The database transaction, exact-path content quarantine, and version-4 commit marker cover
interruption recovery. Before commit, quarantined content is restored; after commit, it is removed.
External operations that are still running or have unknown dispatch results block the reset with an
identified error. The reset neither resends nor cancels them. Completed, failed, and interrupted
operations with a known terminal result do not block it.

The reset behavior, settings preservation, source-file boundary, execution protection, and recovery
cases are covered in `tests/beta-cutover.test.ts`.

## Verification

### Verification requests and large change sets

The execution UI offers explicit verification separately from implementation. Verification prepares
a request with no included change IDs and preserves the task identity and completion condition.
The request permits normal generated build/test artifacts while prohibiting fixes, source/config
edits and Git mutations. Codex receives project-scoped workspace-write access for verification;
this sandbox does not itself distinguish generated files from source, so the reviewed instructions
define that distinction. Additional approvals remain user decisions. Direction stays read-only.
The session adapter uses the official `thread/resume` API when reconnecting.

Scope inventory and diff detail are independent. The inventory fingerprints repository state,
the index and every changed file's content; read timestamps do not change identity. Large diffs
remain listed and can be expanded per file. Initial previews are limited to 80,000 characters
(bytes for untracked files), with detailed reads bounded to 2 MiB. Files beyond review limits remain
excluded while other readable changes can be selected. Commit, discard and unstage still require
exact reviewed scope IDs. Inventory failure blocks confirmation with a retry, and actual project
changes invalidate a prepared request before dispatch.

### Lifecycle validation

`tests/native-project-lifecycle.test.tsx` connects the real HTTP gateways, server, SQLite and Root UI.
It covers empty analysis, entry, English/Korean results before selection, explicit proposal choice,
reanalysis retaining task identity, user-created task discussion, prepare/send/compare/accept and
restart recovery without another analysis call. Focused suites cover delayed responses, source
changes, partial failure, return points, work transitions, scope protection and release state.

Required handoff checks are `pnpm format:check`, `pnpm lint`, `pnpm check`, focused tests and
`pnpm verify`. Desktop smoke checks cover first entry, re-entry, visible analysis and restart.
Deployment and release publication are separate work.

Verified 2026-09-22: `pnpm verify` passed all six stages, including 651 tests across 81 files.
The development desktop build also passed. An isolated data directory and a deterministic analysis
fixture were used in the native desktop window to check empty first launch, project entry, readable
Korean analysis before selection, explicit work selection, re-entry, application restart and a new
proposal alongside the preserved current task. The HTTP/SQLite/UI integration test additionally
checks English/Korean generation with project response-language settings and execution with a test session provider.
No release was published and no existing user data directory was migrated during that historical
validation. The version-4 reset is covered by the current isolated beta-cutover fixtures.

Scope follow-up verified 2026-09-22: 662 tests across 81 files pass. Focused coverage includes a
large tracked diff, per-file expansion, unread content changes, stable read identity, exact selected
scope validation, unavailable inventory recovery, verification instructions and session permissions.
The UI file-expansion test validates its command with the real server command schema, including
rejection of display-only fields on the wire.

An isolated development desktop build passed using a separate copy of the installed Hutch tools
because the existing development app held the shared Cottontail runtime lock. In the native window,
a 2,000-line changed file remained listed, expanded into a selectable change, and could be selected.
Switching to verification preserved the typed `rtk pnpm verify` request, cleared modification
selection, enabled confirmation and reached the prepared-request screen. The test app was restarted
during this check with its saved task and drafts retained. The verification request was not sent to
an external Codex conversation; session dispatch and approval behavior are covered by adapter tests.
