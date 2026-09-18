# UX writing

This document defines the writing rules for active StateCarry product copy. It applies to visible interface text, accessibility labels, notices, errors, empty and loading states, integration status, generated overview framing, and presentation-layer strings that can reach the interface.

Use it when adding or changing user-facing copy. Product behavior remains the source of truth: copy must describe what StateCarry actually does, not what a future design intends to do.

Related product context lives in [problem-definition.md](problem-definition.md) and [return-content-contract.md](return-content-contract.md). The structural UI and interaction contract lives in [ui-principles.md](ui-principles.md). Those documents explain the larger product problem, evidence boundary, screen responsibility and interaction hierarchy. This document is the day-to-day writing contract.

## Product sentence

**Return to a project, understand where it stands, and choose what to do next.**

Every important piece of copy should support at least one part of that sentence: recognize the project, understand the present situation, understand the next choice, or inspect the basis when needed.

## User mental model

Write for a person who remembers the project better than StateCarry's internal model, but may not remember the latest work, conversation, or implementation details.

The ordinary mental model is:

1. A **project** is the work environment the user recognizes and returns to.
2. The project has a **purpose** and may have a current **goal**.
3. StateCarry creates an **overview** of the current project state from available project evidence.
4. An overview can contain one or more **tasks** that need a decision, review, continuation, or deliberate pause.
5. **Project files**, Git, and optional **Codex conversations** can support the overview.
6. StateCarry can suggest a next step, but the user decides whether it is correct, complete, or worth doing.
7. An **original record** is source material opened deliberately for verification. It is not the normal explanation layer.

For the minimum uncommitted-work flow, treat the current repository state as the source of truth. Do not require prior Codex conversations to explain or continue dirty work. StateCarry should inspect the current Git diff and codebase first, reconstruct meaningful work groups, and show that interpretation before continuation. It may also suggest one conservative next step, why that step follows from the current diff, and an observable Done when condition. These are repository-state suggestions, never claims about the user's prior intent. A handoff to a new Codex session should carry that reconstructed state and suggested first action forward; it should not ask the new session to redo broad repository reconstruction unless the current files contradict the handoff.

Do not require the user to understand connections, revisions, candidate keys, checkpoints, source IDs, turn IDs, collection jobs, model settings, or other implementation structures to use the main flow.

## Canonical terminology

Use one term for one user concept. Prefer the terms below unless the interface is explicitly exposing a different technical object for an advanced task.

| Use                                  | Meaning                                                                                                                                    | Avoid in ordinary copy                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **project**                          | The registered work environment the user recognizes                                                                                        | work registration, connection, workspace entry                                             |
| **project folder**                   | The local folder registered for a project                                                                                                  | cwd, path target                                                                           |
| **purpose**                          | Why the project exists or what it should make possible                                                                                     | project intent when a simpler label works                                                  |
| **goal**                             | The result the user currently intends to reach                                                                                             | objective and outcome as interchangeable labels in the same flow                           |
| **direction**                        | The project screen's compact statement of where the project is heading; use the current goal when available, otherwise the project purpose | a second independent goal or AI-ranked priority                                            |
| **overview**                         | StateCarry's prepared explanation of current project state and task choices                                                                | summary, analysis, generated result when referring to the product surface                  |
| **task**                             | A concrete piece of work or decision shown in an overview                                                                                  | candidate, recommendation item                                                             |
| **next step**                        | What the user can do next for a task                                                                                                       | next action when both labels would appear together                                         |
| **Done when / completion condition** | What would make the task ready to accept or review as complete                                                                             | doneWhen, completion predicate, finish condition when another label is already established |
| **project state**                    | The current project-level explanation: current state, recent work, open or uncertain items, and next direction                             | workspace snapshot in product copy                                                         |
| **project files**                    | Files StateCarry inspected in the project folder                                                                                           | codebase, file observations                                                                |
| **Git**                              | Repository branch, revision, and local-change information when available                                                                   | VCS metadata                                                                               |
| **Codex conversations**              | Optional selected Codex conversations used as supporting project context                                                                   | Codex context, source scope, thread set, conversation connection                           |
| **original record**                  | Exact source material opened deliberately                                                                                                  | evidence blob, revision payload                                                            |
| **sources**                          | Project files, Git, Codex conversations, or other supported material behind a displayed conclusion                                         | evidence when the user is choosing what to connect                                         |
| **Home focus**                       | Up to three projects the user chose to keep visible on Home                                                                                | priority, top project, ranked project                                                      |
| **disconnect project**               | Stop StateCarry from checking for new project information while keeping saved work                                                         | remove, delete, archive                                                                    |
| **reconnect project**                | Resume checking the same saved project                                                                                                     | restore project, recreate, reconnect as a new project                                      |
| **delete project data**              | Permanently delete the stated StateCarry-owned project data after scope review                                                             | remove saved application data, remove saved data, disconnect                               |

Use **Workspace** only for the application-level navigation surface if needed. Do not use it as a synonym for project, project folder, project files, or persisted project state.

Use **overview** consistently in visible product copy. Internal types and APIs may still use `resume`, `summary`, or analysis terminology.

## General writing rules

Lead with the user's situation or choice. Explain implementation only when it changes what the user can do.

Use concrete verbs: **add, open, create, update, check, review, save, pause, reconnect, disconnect, delete, copy, retry**. A button label should describe the action that happens after activation.

Prefer one idea per sentence. Helper text should explain a consequence, limit, or reason that is not already clear from the label.

Use sentence case for headings, labels, badges, and buttons unless a proper noun requires capitalization.

Address the user as **you** when ownership or judgment matters. Use **StateCarry** when the system is the actor. Do not use a vague "we" for system behavior.

Avoid product-internal shorthand, unexplained acronyms, implementation names, model configuration, transport language, and diagnostic detail in the ordinary path.

Do not use reassuring filler. State what happened, what remains available, and what the user can do next.

## Status patterns

A status should answer the smallest relevant question: **what is happening, what is available now, and whether action is required**.

### Stable states

Use a short badge or label plus nearby explanation when necessary.

- **Up to date**: the available overview reflects the latest project state StateCarry has checked.
- **Updating overview**: StateCarry is creating a newer overview.
- **Checking current state**: StateCarry is re-reading current project state; this is not the same as generating an overview.
- **Disconnected**: StateCarry has stopped checking for new project information and saved work remains.
- **Offline**: the local service is unavailable and previously loaded state may still be readable.
- **Needs review**: the available information needs user judgment before it should be treated as accepted or complete.

Do not make recency sound like priority. Do not make availability sound like verification. Do not use a successful tool run as a synonym for user acceptance.

### Loading and progress

Name the object being read or prepared:

- `Reading saved project state…`
- `Finding conversations…`
- `Updating overview…`
- `Reading the original record…`

Avoid generic `Loading…` when the object is known.

When previous valid content remains usable, say so if the distinction matters: `Checking changed records. Your saved overview stays in place.`

Do not imply background work is still running when its state is unknown.

### Success and notices

Success copy should state the completed user-visible effect and any meaningful next choice.

Good pattern:

> The goal was saved. Update the overview when you are ready.

Avoid implementation confirmations such as `Command committed` or `Revision updated`.

Do not announce a secondary consequence that did not happen. For example, saving a goal must not imply that StateCarry also prepared a new overview unless it actually did.

## Error and recovery patterns

Errors are product states, not raw diagnostic channels.

Write known errors in this order:

1. What could not be completed.
2. What user work or saved state is still safe, when relevant.
3. The smallest useful recovery action.

Example:

> StateCarry could not read the latest project state. Your saved overview and drafts are still available. Check the local service and try again.

Do not expose raw exceptions, stderr, JSON, stack traces, provider payloads, internal route names, or storage terminology as the primary error message.

If a failure affects only optional context, say that scope clearly. A Codex discovery failure must not imply that the project files or Git information are unavailable when those sources remain usable.

Do not use `unavailable` without naming what is unavailable when the distinction matters: project folder, Git, Codex conversations, original record, or local service.

Preserve uncertainty. If StateCarry cannot confirm freshness, completion, or a source, say that it could not be confirmed. Do not rewrite unknown as failed, running, complete, or safe to continue.

## Button and action patterns

Buttons should describe the immediate effect, not the larger intention.

Prefer:

- `Add project`
- `Choose folder`
- `Create overview`
- `Update overview`
- `Check again`
- `Save goal`
- `Save next step`
- `Accept result`
- `Mark complete`
- `Pause task`
- `Disconnect project`
- `Reconnect project`
- `Review what will be deleted`
- `Delete project data`
- `Open original conversation`

Use **Check for changes** only when a situational project-state read is explicitly offered. Do not keep it as a persistent global action. Use **Check again** when retrying or refreshing a narrowly scoped status. If the action creates AI output, use **Create overview** or **Update overview** according to whether an overview already exists.

Use **Review** when the next step is inspection before a separate irreversible or judgment action. Use **Delete** only when data is actually deleted under the stated scope. Use **Disconnect** when collection stops but saved data remains. Use **Reconnect** when resuming the same disconnected project registration.

Use **Accept result** when a reported or checked result is waiting for the user's judgment. Use **Mark complete** when the user is recording task completion and there is no distinct returned result to accept.

Avoid ambiguous buttons such as `Continue`, `Update`, `Check`, `Manage`, `Remove`, or `Retry` when the object or consequence is not clear from immediate context.

## AI, suggestions, and evidence

StateCarry may prepare explanations and suggestions from several sources. Copy must preserve who established what.

Keep these meanings distinct:

- **You chose / accepted / recorded**: explicit user action.
- **StateCarry observed / checked**: deterministic project or tool evidence within a stated scope.
- **The agent reported**: a conversation or agent report says something happened.
- **StateCarry suggests**: the system proposes an interpretation or next step that still needs user judgment.

An agent report is not independent verification. A check proves only what that check covered. A prepared overview is not user acceptance. A recent change is not proof of priority.

When a suggestion is derived from incomplete evidence, name the missing basis near the decision if it could change the user's choice.

Prefer plain attribution:

> A result is recorded, but you have not accepted it yet.

> A tool check supports this result for the conditions it covered.

> StateCarry suggests this next step from the current project evidence.

Avoid anthropomorphic certainty such as `StateCarry knows`, `AI decided`, or `The agent proved` unless the underlying behavior supports that exact claim.

## Evidence and original records

Routine explanations should tell the user what a source establishes before offering exact source material.

Use this progression:

1. **Decision explanation**: current situation, next choice, reason, Done when or completion condition, material uncertainty.
2. **Explained basis**: source kind, relevant finding, what it supports, and what it does not establish.
3. **Original inspection**: an explicit action to read exact source wording or diagnose a technical issue.

Do not make `Details`, `Why?`, or `Evidence` unexpectedly open a transcript, raw AI response, command log, file preview, or diagnostic payload.

Opening an original record must not imply acceptance, start work, change the goal, or alter the task state.

When quoting or displaying original evidence, keep it as source material. Do not silently translate a quote, rewrite it as a system conclusion, or remove its attribution.

## Progressive disclosure of technical terms

Technical detail belongs where it helps a deliberate technical task.

The default project and task views should use user concepts: project, goal, overview, task, next step, Done when or completion condition, project files, Git, and Codex conversations.

Reveal lower-level terms only when the user chooses a control that requires them. Examples include exact record boundaries, turn/item positions, commit identifiers, source IDs, isolation diagnostics, model configuration, or local executable discovery.

When a technical term is necessary, explain its consequence before or alongside the term.

Prefer:

> Start reading this conversation from this point.

over:

> Configure `startTurnId`.

Prefer:

> Git is not available for this folder. Project files can still be checked.

over:

> Repository inspection partially degraded.

Advanced or diagnostic surfaces may be precise and technical, but they should remain separate from the ordinary return flow.

## Truthfulness to actual behavior

Copy is part of the behavioral contract. Verify the implementation before naming an action or status.

In particular:

- If `Check for changes` is surfaced, it must describe a state read or currentness check. It must not sound like overview generation.
- `Create overview` and `Update overview` may describe analysis/generation because those actions explicitly request overview output.
- Project files and Git status must reflect what was actually inspected. A bounded file sample must not be described as if every project file was checked.
- `Detected · not verified` must not imply a verified integration. If executables are found but isolation or operation has not been verified, the supporting explanation must say what remains unchecked.
- Codex conversations are optional supporting sources. Missing Codex conversations must not be described as making an otherwise readable project unusable.
- Changing response language may translate existing generated overview text without re-analyzing project evidence. Copy must not claim that the project was rechecked unless it was.
- Opening a working conversation or copying task context does not send a message or start work unless the implementation actually does so.
- Disconnecting keeps saved StateCarry work. Deleting project data is a separate operation.
- Deleting StateCarry data must not imply deletion of the original project folder or upstream conversations.
- A project can be registered even when optional conversation discovery fails if the implementation permits it.

If implementation behavior changes, update copy in the same change or explicitly record why existing wording remains accurate.

## Common problem patterns

### Mixed user and implementation vocabulary

Avoid:

> Reload the current source selection after the connection revision changes.

Prefer language around the user-visible object and consequence:

> The project changed after you opened these Codex settings. Read the current selection again before saving.

### Hidden operation behind a generic action

Avoid using one label for several materially different operations:

- re-read project state
- create or update an overview
- recheck Codex capability
- retry a failed source read

Name each operation for what it does.

### Overlong safety explanation

Put the essential consequence next to the decision. Move rare implementation detail to an explicitly requested explanation or diagnostic surface.

For example, a deletion confirmation needs to say what StateCarry data will be deleted, what will remain, and whether the action is reversible. File names for internal logs and implementation-specific storage records belong in technical documentation or a diagnostic view unless they materially change the user's decision.

### Status that depends on hidden implementation detail

A badge such as `Detected · not verified` needs nearby text explaining the user-relevant meaning. Do not expect the user to infer the difference between executable discovery, capability preflight, isolation verification, or a completed analysis run.

## Examples

These examples show the pattern, not mandatory literal copy.

### Project source status

Good:

> **Project files** 24 selected files were read for this overview. Other files may not have been inspected.

> **Git** Git is not available for this folder. Project files can still be checked.

> **Codex conversations** 2 conversations are included as optional supporting sources.

Avoid claiming complete repository coverage from a bounded inspection.

### Optional integration unavailable

Good:

> Codex conversations could not be checked. You can still use the project files and Git information that is available.

Avoid:

> Project analysis unavailable.

when only the optional integration failed.

### Review versus acceptance

Good:

> A result is recorded for this task. Review it against the completion condition before accepting the result.

Avoid:

> Task complete.

when only an agent or tool reported completion.

### Copying work context

Good:

> Task context copied. Nothing was sent or started.

This makes the side effect explicit without exposing clipboard or transport implementation details.

### No next task

Good:

> No next task has been chosen. You can leave the project here or record another goal.

Do not invent a task merely to avoid an empty state.

## Review checklist

Before shipping user-facing copy, check:

- Does the text use the canonical term for the user concept?
- Can someone understand it without knowing StateCarry's internal architecture?
- Does the action label match the handler's real side effect?
- Does the status distinguish reading, checking, creating or updating an overview, reviewing, accepting, disconnecting, reconnecting, and deleting where those differences matter?
- Does an error say what is affected and offer a useful recovery path?
- Do optional Codex conversations remain optional in the wording?
- Are AI reports, deterministic checks, suggestions, and user decisions clearly distinguished?
- Does evidence explain its meaning before exposing original material?
- Are technical terms progressively disclosed rather than placed on the primary path?
- Does the wording preserve uncertainty and source limits?
- Does it avoid claiming broader file, Git, conversation, or validation coverage than the implementation provides?
- If the behavior changed, was the related copy reviewed in the same change?

## Repository rule

Active user-facing copy changes must follow this document. When a product change introduces a new user concept or materially changes the meaning of an existing term, update this guide with the product change instead of creating a second vocabulary in the UI.
