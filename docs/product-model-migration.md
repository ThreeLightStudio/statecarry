# Public Beta native project model

Implementation baseline: database version 3, 2026-09-22. The application reads only the native
project model. The only reader of version 1/2 registrations is the startup cutover in
`apps/server/src/adapters/beta-cutover.ts`.

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
are removed; response-language and app settings are preserved. No browser-selected work or saved
answer is imported into the native model.

## One-time registration-only transition

SQLite initialization performs the transition before ordinary reads or background work. Fresh
installations start at version 3. Version 1 and 2 go directly to version 3 without running the former
version 1-to-2 cleanup.

Preserved: project and connection IDs, names, purpose, folder, Focus, disconnected status, icon/banner
references, selected conversations and read boundaries, discovery/coordination settings, and app/auth
settings outside the content database. Duplicate registrations keep their own identities. Missing
project folders do not cause registrations to be dropped.

Cleared: old analysis, observations, directions, work choices, discussions, execution and release
records, copied source data, and application content caches. Original project files and original
Codex conversations are never changed by this transition.

A database transaction, a temporary database copy, cache quarantine and the version-3 commit marker
cover interruption recovery. Before commit, moved caches are restored; after commit, quarantined
content is removed. Restarting a version-3 installation never resets its new content. External
operations still running or with unknown dispatch results block the transition and are identified in
the error. The transition neither resends nor cancels them. Completed/failed/interrupted operations
with a known terminal result do not block it.

The manual re-registration reset tool is retired. Its preservation, execution-protection and recovery
checks now live in `tests/beta-cutover.test.ts`.

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
checks English/Korean generation/localization and execution with a test session provider.
No release was published and the existing user data directory was not migrated during validation;
its registration-only transition runs when the new server first opens it.

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
