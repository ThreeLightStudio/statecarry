# Return explanations and original inspection

Status: content contract and case drafts, 2026-09-16 KST, based on the owner's latest feedback and source baseline `58306ab`. This advances the [problem definition](problem-definition.md) and prepares the next comparison in the [joint redesign plan](experience-redesign.md). The case outputs are authored examples, not generated application output or completed usability tests. Screen layout, domain schema and production implementation remain subject to the existing gates.

## Required outcome

Someone returning to a project can understand the current situation, decide what to do and explain why that choice serves the goal without interpreting conversations, AI replies or command logs. Optional explanations answer their questions in the same plain language. The person can still deliberately inspect an original when checking wording, reviewing the actual deliverable or investigating a failure.

The owner reported that raw records appeared after one or two levels of detail. This establishes a required change in the experience; it does not establish a universal maximum number of clicks or an independently observed route. Do not solve it by moving the same transcript into another accordion.

## Content and interaction boundary

| Intent                       | What the product supplies                                                                                                                                     | What opening it must not do                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Decide what to do now        | Current situation, next choice, reason, expected effect, essential finish condition and material uncertainty.                                                 | Require source reading to understand the proposed action.                                               |
| Understand a specific point  | A prepared answer to a named question such as "Why does this need review?" or "What will count as finished?"                                                  | Dump the original passage, unedited AI response or an all-purpose history summary.                      |
| Understand the basis         | Relevant finding, what it supports, its limitations, source kind/name and available time. Keep reported, independently checked and accepted results distinct. | Treat the existence of a quote, test count or confident model sentence as proof of completion.          |
| Verify the original          | An explicit "Open original conversation/file" action to the relevant supported destination, with stable return to the decision and unfinished input.          | Require the person to traverse every explanation first, or expose source text when they merely ask why. |
| Diagnose a technical failure | A plain explanation of the impact and available recovery, with separately requested technical details.                                                        | Substitute raw exception strings, stderr, JSON or stack traces for recovery instructions.               |

The first three roles belong to the explanatory experience. They may share one view and one optional panel; they are not three compulsory screens. Original inspection is a separate intent, not the next depth. Prefer the existing source tool when its destination is supported; do not introduce a general in-app transcript browser by default. When an in-app source viewer is necessary, label and isolate it, preserve the prior view and retain existing source-access checks. An unavailable or imprecise source link must be described accurately.

Do not reopen an original viewer automatically on ordinary reentry, silently run analysis on expansion, or let original inspection mutate the goal, acceptance state or next action. A deep link that explicitly targets original inspection is different from ordinary reentry. Browsing a source is not approval of its contents.

An actual deliverable can be the object of review. A user reviewing a changed page, code diff or document needs access to that artifact. This requirement does not hide it; the review explanation must make clear what to inspect and why. A tool transcript or AI completion report supporting the review remains separate.

## What makes an explanation ready to show

An explanation must connect the finding to the current decision, use recognizable work descriptions and preserve the source's limits. Shortening a model reply, changing its formatting or storing it under `summary` does not establish those properties. A rewrite by another model does not independently verify it either.

Keep source references and scope behind each material claim so a later correction, missing record or changed goal can invalidate the appropriate conclusion. Show attribution in ordinary language: "The agent reported this change", "This check passed for these conditions", or "You accepted this result". Keep an unresolved conflict or unchecked condition visible when it changes the choice. Show source/observation time when known; do not substitute the explanation's generation time or invent freshness.

The later headless contract should distinguish explanation content, evidence descriptions and original access. UI consumers should not need to choose between a narrative and an arbitrary raw string. Reuse current validity and action rules; these are contract requirements, not a demand for another service, model, database table or prompt-only solution. Stored valid explanations and deterministic messages for known states can satisfy parts of this contract without another model request.

## Three cases using the same project

All cases concern StateCarry's goal of helping someone return to work and choose a sensible next step. Case A uses the current reported problem as its premise. Cases B and C are explicitly hypothetical later states, provided to test the content structure. They must not be presented as changes or acceptance that have actually occurred.

### A. Return during unfinished work

Premise: the owner has reported early raw exposure; the team is still deciding what the replacement should explain. No replacement screen or successful trial exists yet.

> **StateCarry — return to a project and understand what to do next.**
>
> **Where things stand:** The owner reported having to interpret records and AI replies after opening only a little detail. The replacement's explanations are still being defined.
>
> **Next:** Review the proposed first explanation and optional answers for three return situations.
>
> **Why this matters:** These examples will define what the new screen must explain so someone can choose the next step without reconstructing a conversation.
>
> **This step is finished when:** The owner has reviewed what each example explains, which choices it supports and what information is still missing. An unassisted prototype trial is still needed afterward.

Optional question, **"What problem must the new explanation solve?"**:

> Asking why a task matters should reveal its purpose and the reason for the next choice. It should not require reading the original exchange. We have the owner's report of this difficulty; we have not independently recorded the exact screen and click sequence.

Explained evidence, **"What is this based on?"**:

> The owner's feedback on September 16, 2026 says that unprocessed records, including AI replies, appeared after one or two levels of detail and increased the effort to understand the work. This supports changing the explanation structure. It does not yet establish that the proposed replacement is easier to use.

Expected decision: continue reviewing the content cases, identify a missing answer or deliberately defer. Do not jump straight to coding an accepted replacement. Exact wording can be inspected through a supported original-conversation action; the ordinary decision does not depend on it.

### B. Return after a delegated result arrives

Hypothetical premise: the agreed assignment was to stop routine explanation panels from exposing raw records. The agent reports a change; controlled checks cover those panels. The owner has not yet tried the replacement.

> **StateCarry — a change is ready for your review.**
>
> **Where things stand:** The agent reports that routine explanation panels now show prepared answers. Automated checks cover those panels; whether the answers make the next step understandable has not yet been tested with you.
>
> **Next:** Try the replacement using the three agreed return situations, then record what still needs changing or accept the result.
>
> **Why this matters:** Hiding transcripts is only part of the goal. You also need enough explanation to choose what to do without reading them.
>
> **This step is finished when:** The observed choices and any confusion have been recorded, and you have accepted the result or requested a specific correction.

Optional question, **"What should I check?"**:

> For unfinished work, find where it stopped and choose what to continue. For a returned result, identify what still needs review. For completed work, check whether another objective has been chosen. The explanation should make the reason and finish condition understandable in each case.

Explained evidence, **"What do the checks establish?"**:

> The controlled checks cover whether original-record text appears when the explanation panels open. They do not establish that the wording is correct or understandable. The agent reported completion, but your acceptance has not yet been recorded.

Prototype data must identify the covered panels and source/check time where available, or explicitly mark missing time. During the walkthrough, observe the first choice before asking the participant to explain it. These are fixture and facilitator requirements, not additional UI prose.

Expected decision: review the changed interface, request a correction or accept only after evaluating the agreed conditions. The replacement interface is the deliverable under review; an AI reply or terminal transcript is not a substitute. An explicitly requested original-report or check-log inspection remains available separately.

### C. Return after completion without a next objective

Hypothetical premise: the owner has completed the walkthrough and explicitly accepted this explanation change. No successor objective has been recorded. Acceptance applies to this change, not the whole product or release.

> **StateCarry — this change has been accepted.**
>
> **Where things stand:** You accepted the explanation change after the agreed walkthrough. No next objective has been chosen.
>
> **Your choice:** Leave this project as it is for now, or choose another objective.
>
> **Why:** The current objective is complete. That does not establish what should take priority next or mean that the whole product is ready to release.
>
> **This visit is complete when:** You have decided to leave the project for now or recorded the next objective. No additional task is required just to clear this view.

Optional question, **"What exactly was accepted?"**:

> The reviewed change addressed how this project explains work on return. Acceptance was limited to the agreed cases. It did not approve installation, release readiness or every other use of the product.

Explained evidence, **"Why is the current objective shown as complete?"**:

> Your recorded acceptance applies to the explanation change and the agreed return situations. An agent's completion message alone would leave this awaiting your review.

Prototype data must preserve the acceptance scope and its recorded time, or state when that time is unavailable. The hypothetical acceptance used here is not a claim about the current project.

Expected decision: leave, pause if useful, or choose a new objective. Do not regenerate the finished action, invent a backlog or imply that a product-wide milestone has passed. Voluntary review of the acceptance record must return to this completed state.

## Missing, conflicting and failed states

| Condition                                                     | Required ordinary explanation and available choice                                                                                                                                                       | Original-data boundary                                                                                                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| No saved explanation or no connected session                  | State what is known from an existing user goal/note and what is missing. Offer the smallest useful correction, permitted source connection or explicit preparation action. No invented next step.        | A discovered conversation or model payload does not become the default body.                                            |
| Preparation is running                                        | Explain what is being prepared and preserve valid prior context where available. Keep cancel/leave behavior predictable; only block actions that need the unfinished check.                              | No streaming provider output or agent progress transcript in an explanation panel.                                      |
| Preparation fails or returns invalid content                  | Explain that a usable account could not be prepared. Preserve valid existing context and input; offer an explicit retry or context correction.                                                           | No raw reply, malformed JSON, exception message or excerpt as a fallback. Diagnostics require their own action.         |
| A prior explanation is stale                                  | State what changed or cannot be confirmed and how that affects the proposed action. Retain it for limited reading only where the existing validity rules allow; current action restrictions still apply. | Neither a raw fallback nor a silently authoritative old summary is acceptable.                                          |
| Sources disagree                                              | Explain the disputed conclusion and which decision needs clarification. Attribute each relevant report or observation without choosing one merely because it is newer.                                   | Do not make the user reconstruct the conflict from two transcripts. Optional exact-wording inspection remains possible. |
| The AI suggests the wrong work or action                      | Preserve the distinction between a suggestion and the owner's goal. Offer the relevant correction or rejection without making the user repeat the entire project.                                        | Showing the original AI argument is not the correction workflow.                                                        |
| A supporting record is inaccessible, removed or outside scope | Apply current validity/access rules; withdraw an unsupported conclusion where required, explain the missing basis and preserve unrelated valid context.                                                  | Do not revive a cached quote, reveal a removed record or regenerate from a forbidden source.                            |
| A destination or source tool is unavailable                   | Explain which record cannot be opened and offer a supported retry, locator or isolated viewer only if available. Keep the current work and input intact.                                                 | Do not redirect generic detail to another raw dump or claim an exact destination that cannot be opened.                 |

## Current source exposure inventory

The implementation audit below records source behavior at `58306ab`, not the exact interaction reported by the owner. The proposed disposition is input to 7D/7G; no current component has been changed by this planning pass.

| Current path                                            | Source evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Proposed disposition                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resume recommendation reason and completed-work detail  | [Resume.tsx](../apps/web/src/ui/Resume.tsx), lines 20–64, 1383 and 1521–1550: opening either explanation renders stored quotes. The latter also links to the original API and legacy details.                                                                                                                                                                                                                                                                         | Keep the reason, progress and reported/checked distinction as prepared explanations. Move original inspection behind a clearly named action. Retire the mixed context/settings detour when replacing this flow.                                                                                                                                       |
| Explanation and question citations                      | [HandoffExplanation.tsx](../apps/web/src/ui/HandoffExplanation.tsx), lines 45–131 and 229–271; [ContextQuestions.tsx](../apps/web/src/ui/ContextQuestions.tsx), lines 89–149; [explanations.ts](../packages/presentation/src/explanations.ts), lines 146–156: explanation/citation controls lead to quote and full-source rendering.                                                                                                                                  | Keep the structured explanation and attribution. Supply explained evidence before any separately requested original. Preserve scoped source access and late-response rejection.                                                                                                                                                                       |
| Legacy source browser mixed into work detail            | [App.tsx](../apps/web/src/ui/App.tsx), lines 794–872; [controller.ts](../packages/presentation/src/controller.ts), lines 510–525; [presenter.ts](../packages/presentation/src/presenter.ts), lines 489–501: original text passes through to the source panel. [Root.tsx](../apps/web/src/Root.tsx), lines 18, 65–80 and 110–120 routes details into the legacy App.                                                                                                   | Separate deliberate source inspection from routine work explanation and connection management. Retire the competing legacy journey after its replacement is accepted; preserve owned data and valid inspection access.                                                                                                                                |
| Project checks and file previews                        | [Resume.tsx](../apps/web/src/ui/Resume.tsx), lines 75–101, 129–195 and 1379–1382: nested project details include file previews, hashes and diagnostic strings.                                                                                                                                                                                                                                                                                                        | Keep whether the project changed, what was checked and how missing checks affect the action. Move supporting file text and technical diagnostics to explicit inspection. A folder/branch may remain visible when needed to identify the intended working context.                                                                                     |
| Collection setup and connection metadata                | [App.tsx](../apps/web/src/ui/App.tsx), lines 306–382 and 981–1013: starting-range selection exposes internal turn IDs; connection detail mixes model/summary metadata and evidence actions.                                                                                                                                                                                                                                                                           | Keep recognizable conversation names, read scope, available time and missing coverage. Reserve direct ID entry and diagnostic metadata for an explicit advanced task. Preserve the user's ability to choose the allowed range.                                                                                                                        |
| Errors, preparation diagnostics and absent explanations | [Resume.tsx](../apps/web/src/ui/Resume.tsx), lines 202–214; [App.tsx](../apps/web/src/ui/App.tsx), lines 39–49: short unclassified errors pass through. [HandoffExplanation.tsx](../apps/web/src/ui/HandoffExplanation.tsx), lines 296–300, 342–346 and 418–442: absent summaries instruct the reader to inspect collected sources; status details render job errors/timing. [presenter.ts](../packages/presentation/src/presenter.ts), line 429 forwards job errors. | Replace the missing-explanation instruction with a clear unavailable state and recovery choice. Prepare error messages by known condition, with a meaningful generic fallback for unknown cases. Separate technical diagnostics. The audit found a source-reading instruction, not automatic replacement of the entire main body with a raw response. |

The manual handoff is another explicit review/export surface: [Resume.tsx](../apps/web/src/ui/Resume.tsx), lines 1364–1377 displays a prepared message; [resume.ts](../packages/presentation/src/resume.ts), lines 624–646 and 707–716 includes quotes and conversation identifiers in that payload. Keep the concise action explanation in the routine flow. Specify what the handoff preview and copy action include, and do not silently change evidence required by the execution contract just to remove it from a UI panel.

Reuse the existing compact narrative boundary in [ResumeBrief.tsx](../apps/web/src/ui/ResumeBrief.tsx), lines 14–36 and [resume.ts](../packages/presentation/src/resume.ts), lines 163–235. It presents current state, reason, action and finish condition without copying evidence quotes into the main body; it already distinguishes reports from checks. Its generated prose still needs evaluation against this content contract. Structured AI content is not automatically an unprocessed response, nor is structure alone proof of understandable or correct wording.

Historical stage-5 descriptions remain accurate descriptions of that version; this contract supersedes their exposure policy for the replacement. This inventory is a static source review, not a complete screen audit or observed owner walkthrough.

## Content-only concept comparison

This begins the next concept comparison using the three cases above. These are design predictions, not measured usability or benchmark results. Every candidate must satisfy the same explanation/original boundary; a concept does not win simply by hiding information.

| Entry concept                             | How it would use the same content                                                                                                               | Question the comparison must resolve                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation entry                        | Select a recognizable conversation, then explain the related work, its reason and remaining decision.                                           | Can cases B and C retain the request and acceptance when they occur in other conversations, without asking the reader to piece them together?                        |
| Project entry                             | Recognize StateCarry, then show the current unfinished decision, returned result or accepted objective and its relation to the project purpose. | Can the person select the right work when a project contains several unrelated goals, without another compulsory navigation layer?                                   |
| Work/objective entry with project context | Recognize the pending outcome first, with StateCarry and its purpose alongside it.                                                              | Can the person recognize that outcome after a long absence without maintaining a separate task hierarchy or remembering internal labels?                             |
| Existing IDE/chat or a short project note | Reopen the working tool or read a manually maintained purpose, stopping point and next choice.                                                  | Does StateCarry reduce reconstruction and maintenance enough to justify using another application? Compare effort and actual choices, not a claimed speed advantage. |

Recommendation for review: use the project to make the work recognizable and the current work or pending decision to determine the explanation. Conversations supply attributed evidence and a place to continue. Test this against work-first entry with the same content, without assuming an additional project-selection screen is necessary. This recommendation does not settle one-folder/one-project identity, persistent entities, ranking or navigation.

## Acceptance draft

Use the same three cases and expected decisions above when comparing project-oriented, work-oriented and existing-tool alternatives. Give the participant the return situation and goal, without teaching controls or telling them the expected answer. Record the first decision before probing understanding.

The routine path passes the content boundary only when its default and optional explanations remain prepared for the question, including missing, invalid, failed, stale and conflicting states. It must expose decision-changing limits, not merely avoid raw text. Render checks should cover the real root/navigation and relevant callers, verify that known raw fixtures never appear in ordinary explanatory DOM or accessibility output, and separately verify explicit original access. Do not implement this by rendering raw content and hiding it with CSS, generic truncation or a broad regular expression.

Human acceptance additionally requires an appropriate choice, an understandable reason and a known finish condition without needing originals to decode the task. Deliberate source verification after understanding the explanation is a separate successful path, not an automatic failure. Test that exact-source inspection can be found, returns to the same work and unfinished input, and does not trigger analysis, acceptance or execution. Measure necessary reconstruction separately from optional auditing; do not discourage verification to improve a raw-open count.

The cases and content-only comparison advance 7B and prepare 7C/7D; they do not mark those gates complete. Compare the candidate organization with ordinary IDE/chat reopening and a short project note before accepting a screen. The full recovery/removal paths, original real-work-return gates and no-coaching prototype evaluation in the redesign plan still apply.
