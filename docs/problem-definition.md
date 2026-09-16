# Project return and next-decision problem definition

Status: owner-informed **7A draft for discussion**, 2026-09-16 KST. This records the owner's explanation and proposed consequences. It does not approve a screen, persisted schema, ranking algorithm, automatic execution, or the later implementation stages. See [the joint redesign plan](experience-redesign.md).

## Reported background and intended outcome

The owner gathered projects that had been scattered across Finder paths beneath one projects root so Codex could help manage them. This made their locations more manageable. It did not remove the repeated conversation and interpretation needed to recover what was happening and choose the next work. Returning after unrelated external activities, especially a long absence, could feel like receiving the project for the first time.

The intended benefit is to delegate the work of reconstructing context and preparing the next decision. The owner now sees project-level understanding as necessary, because choosing and connecting individual sessions has not supplied a coherent account of the work. Codex conversations remain useful inputs and destinations; remembering a conversation must not be the price of understanding a project.

The owner described two principal return situations: leaving during unfinished work, and leaving after finishing work. Whether something was delegated before leaving changes the required result again. The stated outcome is to understand what to do immediately next and then check that choice against the direction of the overall work. This does not require one identical task, button, or next action on every visit.

On 2026-09-16 the owner identified early raw-data exposure as a major problem in the previous version: after only one or two levels of detail, unprocessed records, including AI replies, required more reading and interpretation. The owner requires this to change in the redesign. Treat that depth as a reported experience; the precise route and running build have not been independently observed. Moving the same raw body one accordion deeper would leave the interpretation burden unresolved.

These are user-reported needs, not observations of a timed usability test. The running build and exact interaction from the earlier unsuccessful visit remain unrecorded. Nothing in this draft changes the recorded engineering results or establishes product acceptance.

## Proposed problem statement

> When returning after working across projects or being away, recover the relevant project's last meaningful state, why the work matters and what has changed, so the user can choose an appropriate next action or decision without reconstructing multiple conversations, and check that choice against the intended direction before committing to it.

The first useful result is a **grounded next decision with enough context to act or deliberately defer**. Depending on the situation, it may be continuing work, reviewing a delegated result, resolving a blocker, accepting completion, selecting the next objective, pausing the project, or choosing another project. It is not invariably a generated implementation instruction.

Distinguish two questions: "Can this next action be started with the available information and prerequisites?" and "Is it still worth doing now?" Evidence about code or a completed command can help with the first; the second also depends on the owner's intended outcome and current priorities. Being recently active does not establish priority. Being technically executable does not establish value.

## Reorganizing the owner's return questions

The depth in the owner's question chain describes dependency between answers. It must not become an equally deep navigation tree.

| Question group          | Questions to answer                                                            | Information the product should prepare                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Recognize the work      | What was I doing? What did I last finish?                                      | Recognizable project and work, last meaningful action or result, recorded stopping point.                                                       |
| Recover the reason      | Why was I doing it? What larger result did it serve? What gets better?         | Intended project benefit, current objective, the causal connection between this work and that objective.                                        |
| Recover the position    | What has actually been achieved? What is still open?                           | Accepted outcomes, reported but unreviewed results, remaining work, decisions and dependencies. Do not substitute activity counts for progress. |
| Check current relevance | Is it important now? Should I continue immediately?                            | Previously chosen priority and reason, relevant deadlines/dependencies, known changes since that choice, and missing information.               |
| Choose the next move    | Continue, review, wait, change direction, finish, or select another objective? | A proposed next move, its source and reason, unmet preconditions, and the result that would finish it.                                          |

Display the proposed next move early, with a compact explanation of the current state and goal connection. Deeper history is optional. This supports "see what is next, then check direction" without starting work before the direction check. The interface should not force the user to read a full strategic hierarchy before discovering a pending result or question.

## Return situations and conditional happy paths

These are situations for the relevant work, not mutually exclusive statuses for a whole project. A project may have unfinished work, a completed deliverable and a pending delegated result at the same time.

| Situation on return                                               | First useful information                                                                                                      | Appropriate next move                                                                  | Incorrect behavior to prevent                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| User left unfinished work                                         | Stopping point, unresolved question, related working context and whether the plan still holds.                                | Continue the same work or resolve the remaining question.                              | Reconstructing all session history, or blindly reopening the most recent session.                     |
| Work was delegated and a result is available                      | Original request and completion condition, returned output, reported/checked status and what still needs the user's judgment. | Review the result against that request, then accept, request a correction or continue. | Treating agent completion as user acceptance and automatically proposing another implementation task. |
| Delegation is still running, waiting or failed                    | Actual available execution evidence, blocker or required input, and what is unknown.                                          | Supply the missing input, inspect the failure, deliberately wait or choose other work. | Duplicate dispatch, an invented result, or presenting unknown status as running.                      |
| A task is finished but its parent objective is open               | What the task achieved, what remains for the objective and any previously chosen next step.                                   | Validate the next planned step or choose among the remaining outcomes.                 | Recommending the completed task again or declaring the entire project complete.                       |
| The current objective is finished and a next objective was chosen | Completion evidence and the next objective's purpose and prerequisites.                                                       | Start or revise that next objective.                                                   | Losing the transition between outcomes when changing sessions.                                        |
| Work is finished and no next objective exists                     | The outcome already achieved, whether the project purpose still suggests work, and the absence of a chosen next objective.    | Define a next objective, pause/archive the project, or choose another project.         | Manufacturing a backlog to avoid an empty next-action field.                                          |
| The prior plan no longer fits known circumstances                 | The former rationale, the relevant changed condition and the decision it affects.                                             | Reassess direction before resuming the old plan.                                       | Preserving the previous recommendation as timeless authority.                                         |

The common return sequence is **recognize the project/work -> see the present situation and proposed next move -> check its connection to the intended outcome and current conditions -> choose -> begin in the appropriate working context**. These are responsibilities, not five required screens. An explicit pending request/result may be the entry point, so the system should not force an extra project selection in that case.

If the user has not chosen a project, provide a small cross-project view of meaningful stopping points, results awaiting review and owner-selected priorities. Keep recency, attention and priority distinct. Do not infer the user's entire work or life priority from the projects visible to StateCarry. Cross-project comparison is a bounded aid to choosing where to return, not permission to build a general planning platform.

## Project-oriented understanding: proposed responsibilities

The owner's project-oriented requirement is now grounded in an explicit scenario. The exact identity and interface remain design decisions for 7B–7F.

| Concept            | Proposed responsibility                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project            | Durable point for recognizing related work, its purpose, environment and meaningful history. A folder locates it; renaming a folder should not conceptually create a different project.    |
| Objective          | An intended result and the benefit of reaching it. A project can have changing objectives; an objective may be absent or deliberately finished.                                            |
| Work/action        | A concrete contribution to an objective, including its stopping point or next decision. Do not require a manually maintained task tree for every small action.                             |
| Decision           | Why an objective, approach or priority was chosen and what conditions would change it. Preserve changes in direction without requiring replay of all dialogue.                             |
| Request/result     | What was delegated, expected outcome, available result and whether it has been reviewed. Completion of execution and acceptance of the result are separate.                                |
| Source/destination | Files, Git observations, notes, Codex conversations and checks that support an assertion or provide a place to continue. A session's lifecycle does not determine the project's lifecycle. |

Start with one project, one current objective and one relevant work/request for the prototype. The conceptual relationships above need not become separate tables, routes, labels or required fields. Codex can remain the first supported integration. A no-session example should still show a user-saved purpose, stopping point or explicitly missing context; no second real provider is required to test that value.

Project-first does not mean reading every file and asking a model to infer intent. File observations can establish changes within their checked scope; they cannot alone establish why the owner cares about the project. A conversation may record a decision or completion report, but does not by itself establish current priority or successful acceptance. Keep the source, observation time and limits of each statement available.

## Minimum information to make a return useful

The following is a content contract to test, not a proposed database schema or seven cards that must all be displayed.

| Information                    | Minimum useful content                                                                       | When missing                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Project purpose                | What gets better if this project succeeds.                                                   | Preserve "not yet stated"; propose a short interpretation for correction only if useful. |
| Current objective and position | Intended result, accepted progress and remaining gap.                                        | Distinguish unchosen objective from unfinished work.                                     |
| Last meaningful state          | Last result or decision and unresolved stopping point.                                       | Show available observations without inventing a stopping point.                          |
| Pending request/result         | Request, done condition, output and review status, if relevant.                              | Do not fabricate execution monitoring or assume all work was delegated.                  |
| Next move                      | An action or decision, why it follows, what it would achieve and where to begin.             | State the missing choice or information that blocks a recommendation.                    |
| Current relevance              | Owner's priority rationale, dependency/deadline and changed conditions, when known.          | Label the limits of the recommendation; do not produce an unexplained importance score.  |
| Evidence and freshness         | Supporting source/time, checked scope, reported versus observed versus user-accepted status. | Retain uncertainty and provide a targeted way to inspect or supply what matters.         |

Persist explicitly chosen goals/decisions separately from machine observations and suggestions. New observations may produce a proposed update, not silently rewrite the owner's intention. Preserve the previous meaningful state alongside material changes; "last saved" and "currently observed" answer different questions. Conflicting sources should produce a visible unresolved question, not an arbitrary winner based on recency alone.

## Keep the maintenance cost below the benefit

Project registration establishes identity, allowed source scope and whatever purpose is already known. Do not require manually linking every session before first value. Sources can be suggested from available project evidence, but matching a folder or branch alone is not sufficient proof of a shared goal. Ambiguous associations remain reviewable.

Capture decisions, outcomes and stopping points when they become available during work, not only through a mandatory "save before leaving" ceremony. The user may leave unexpectedly. A short end-of-work note can be an optional fast path; the product must remain useful with partial context and say what is missing.

When work is delegated, preserve the request and expected result at dispatch or explicit registration. When a result arrives, associate it with that request and expose the review needed. For external changes that StateCarry could not observe, offer a small update such as a changed deadline, priority or newly completed activity. Do not require the owner to retell the project.

Reentry should read the saved project state and available changes. It should not repeatedly analyze every conversation and file merely because the page was opened. The scheduling of observations and any model updates is a later technical decision, with costs and source scope made explicit. This document creates no scheduled or background process.

## Explain without assuming knowledge of this project's internal terms

The owner added a requirement on 2026-09-16: write every return explanation for a reader who does not know the project's internal terms or remember its history. This is not a request to assume no professional knowledge. Explain the particular work, objects and consequences before relying on local shorthand, stage numbers or prior decisions. Apply this requirement to default text, expanded explanations, suggestions, completion messages and recovery instructions, as well as to design examples used in discussion.

The previous example failed this requirement: "technical repairs", "route checks" and "use flow remains confusing" name internal activity or an unspecified conclusion without making the user's situation concrete. Expanding all background into a longer first screen would create a different problem. The proposed target is enough explanation to choose sensibly, with optional detail that answers a recognizable question.

Translate a needed internal term into a concrete trigger and consequence. For example, "cross-work state" becomes "a goal written for one project could be saved to another project"; "round-trip persistence" becomes "after viewing supporting details and returning, the selected work and unfinished text should still be there". If the earlier repair is not needed for today's decision, omit it from the default account instead of adding a glossary. A technical identifier may remain in implementation instructions or source evidence when it helps the actual task, with its role explained where needed.

| Owner's question about the earlier example                                         | Minimum answer near the current decision                                                                                  | Optional explanation                                                                                                                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| What were the work-state and screen-return problems?                               | Do not use unexplained internal names. Include the concrete symptom only if the earlier repair matters to today's choice. | Example of the old behavior, expected behavior, implementation and test record.                                                                   |
| Why were those changes made?                                                       | Where relevant, connect the change to preserving the right project and unfinished input.                                  | The original failure, chosen remedy and alternatives.                                                                                             |
| What exactly was confusing in actual use?                                          | Attribute the report to the owner; state the reported difficulty and any uncertainty that affects the next step.          | Specific screen, attempted choice and observation, when available. Do not invent a click sequence or promote a hypothesized cause to observation. |
| What improves if the current objective succeeds, and why does that matter overall? | State the user's benefit and the causal connection to the project purpose. "Important" is not an explanation.             | The broader goal, prior decision and competing priorities. Do not imply an unrecorded priority choice.                                            |
| What is the basis for calling this step finished?                                  | Name the observable result and the essential way it will be checked. Mark it as proposed until agreed.                    | Cases, allowed outcomes, evidence and the person who accepts the result. Distinguish this step's completion from acceptance of the product.       |

### Proposed information layers, not a mandatory sequence of screens

The owner's raw-data requirement supersedes the earlier proposal to place original passages at layer 2. Every layer used to understand the work must supply an explanation prepared for that decision. Original inspection is a separate, explicitly named activity; increasing click depth is not the remedy.

| Content role                     | Reader's purpose                                                            | Content and navigation proposal                                                                                                                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Default explanation**      | Understand the work and decide what to do now.                              | Recognizable project/work, relevant present situation, proposed next move, why it matters, expected benefit, essential finish criterion and decision-changing uncertainty. Keep the shortest accurate causal connection visible.                                                                     |
| **1 — A specific question**      | Understand the reason, example or check in more detail.                     | A prepared answer beside the relevant statement or in a stable supporting panel. Labels such as "Why does this need review?" and "How will we check it?" identify the question. Opening the answer never reveals a transcript or unedited AI reply.                                                  |
| **2 — Explained evidence**       | Understand what supports the conclusion and its limits.                     | State the relevant finding, what it establishes, what it does not establish, the source kind/name and its available time. Keep reported, checked and owner-accepted results distinct. This can share the optional panel with layer 1; it is not another required screen or a raw excerpt list.       |
| **Separate original inspection** | Intentionally read exact source wording or investigate a technical problem. | Use an explicit label such as "Open original conversation" or "Inspect original file" with a clear destination. Prefer the source tool where supported. A necessary in-app viewer is isolated from explanatory panels. Preserve the project, pending decision, draft and reading position on return. |

Use the default view plus one level of optional explanation as the initial interaction hypothesis. The roles above are not a universal depth optimum or four required navigation steps. A source action may be directly reachable without opening every explanation; only that explicit action exposes the original. Generic "Why?", "Details" or "Evidence" controls must not unexpectedly open raw records. Avoid nested "why -> why -> why" panels. If the user needs another expansion to understand the current decision, revise the initial explanation before adding depth.

Here raw material includes unedited AI responses, conversation excerpts, provider payloads, command logs, stack traces and internal diagnostic fields. An AI-written summary is not automatically product-ready merely because it is shorter or stored in a `summary` field. Its content must answer the current question, preserve attribution and uncertainty, and satisfy the same explanation contract. Another model's rewrite does not independently verify a claim. Traceability and original records remain available within the existing access and deletion rules; hiding them from routine explanation does not discard them.

Assign information by its role in the current decision. When reviewing a test result, promote the interpreted result, failed conditions and unchecked scope, rather than the terminal transcript. A changed deadline, contradiction or failed prerequisite belongs in the default explanation if it changes whether to proceed. When the actual task is to inspect a code change, image or document, the requested artifact remains available as the object of that review. That is distinct from requiring a supporting log or AI completion message to reconstruct the task. A new or long-absent reader may need more orientation; do not hide essentials based on an assumed expertise score.

For each sentence, ask whether omitting it could change the chosen work, the reason to proceed, the expected effect, or the interpretation of completion. Retain that meaning in layer 0 when it could. Use explained evidence to substantiate an already understandable claim. All layers retain the same qualifications: "reported" cannot become "verified", and a proposal cannot become an owner decision. Irrelevant history need not appear. Necessary context may repeat briefly; complete summaries should not.

Missing or failed explanation is also a product state. Describe what cannot be established and the available recovery choice; retain an older explanation only when its scope and supporting records remain valid, with current limitations and action restrictions. Never replace the explanation with the raw reply, an arbitrary excerpt, JSON or an error string. The [return-content contract and three case drafts](return-content-contract.md) make this boundary concrete for the next design work.

## Representative content example

This example illustrates the proposed default explanation using the current discussion. It is not an application output, accepted screen or completed user test.

> **StateCarry — helping you return to projects after time away**
>
> **Next:** Decide what the first page must explain when someone comes back to their work.
>
> **Why now:** After trying the app, its owner reported having to interpret original records and AI replies after opening only a small amount of detail. The replacement must explain the next choice without making the reader reconstruct those records. The precise visited screen and build have not yet been observed.
>
> **What this contributes:** Agreeing the needed explanation gives the replacement page a concrete job: help someone choose the next step and understand why it serves the project's goal, without reconstructing previous conversations.
>
> **This step's proposed finish:** Agree the necessary information and expected choices for three examples: unfinished work, a returned delegated result and finished work without a next objective. Checking whether someone can use those explanations without coaching is the next validation, not a success already achieved.

The first explanation need not recount the prior technical fixes. If asked "What was fixed before this?", the next layer can explain that earlier repairs addressed a goal being saved to the wrong project and unfinished input or selection being lost after viewing details. Those repairs protect the work already entered; they do not establish that the page explains what to do. The engineering evidence is in [stage 4](roadmap.md#stage-4-behavior-and-regression-scope) and [stage 5](roadmap.md#stage-5-behavior-and-validation-scope).

For "What exactly was confusing?", distinguish the owner's report from a proposed mechanism: the owner reported unclear overall flow, competing old UI, inability to delete old records, and early exposure to raw records including AI replies. The raw-reading burden is now explicit user feedback. The exact visited build and sequence remain unobserved; do not invent those details or claim that all confusion has one established cause.

For "How will we judge the explanation?", define expected acceptable decisions before the trial. In an unfinished-work example, the reader should locate the stopping point and choose a sensible continuation or justified pause. For a returned result, they should compare it with the request and understand what remains to be accepted. For completed work without a successor, they should recognize that a new objective is not yet chosen instead of restarting the finished task. Record whether they actually make that choice, can relate it to the purpose and know the outcome that would finish it. Do not grade them on repeating a model-written sentence or accept an arbitrary AI quality score.

This project's technical history is supporting context for the current design decision. The same history could be default content when the task is to review a repaired behavior. Likewise, a delegated-result view needs the requested and returned result near the first choice. The design must respond to what the reader is deciding now rather than always showing the same summary fields.

## Acceptance questions for later prototype testing

Test an interrupted work item, a delegated result awaiting review, and a completed objective without a predetermined successor. Include at least one missing-session case and one case where a relevant condition changed. These cases supplement the original real-work-return acceptance; they do not replace it with a larger synthetic test count.

For each case observe whether the owner recognizes the project, distinguishes what was done from what was accepted, identifies the next appropriate decision, explains why it contributes to the objective, and chooses a sensible continuation or deliberate stop. Include the path into the actual file/tool/conversation when implementation reaches 7G. A completed step followed by another visit must not reappear as unfinished merely because a different session is selected.

Add a comprehension check with someone who does not know the internal project vocabulary, or a genuinely unfamiliar work example for the owner. Give a realistic goal without naming controls or teaching the previous decisions. Observe their first choice before probing for explanations. Classify extra questions: missing meaning, missing reason/criterion, optional verification, or genuinely missing evidence. Frequent meaning/reason questions require rewriting or promoting information; source inspection can be intentional and is not automatically a usability failure. Compare the relevant case before and after a rewrite. An explanation that feels reassuring but produces the wrong choice does not pass.

For the raw-data requirement, first test whether the routine decision and its reason can be understood with originals closed, then separately test voluntary source verification and return. If the reader must open a transcript just to learn what to do or why, the explanation failed. Exercise long AI output, missing summaries, failed generation, conflicting evidence and stale/missing sources. In every state, named explanation panels stay curated and decision-changing uncertainty stays visible. Structural checks can detect raw-field leakage; human trials must still establish comprehension and appropriate choices. See the [case-specific acceptance draft](return-content-contract.md#acceptance-draft).

Measure the time and help needed for the first appropriate decision separately from actual work start. Record repeated questions, backtracking, wrong-work starts, review mistakes, perceived effort and the effort to keep the project state current. Compare with reopening the existing tools and with a short project note. No universal time target, priority score or success rate is accepted yet.

Data control remains part of acceptance: distinguish archive, disconnect, removal of StateCarry-owned work/data and upstream deletion. Preserve the detailed scope/recovery/shared-evidence questions in [the deletion plan](experience-redesign.md#deletion-is-a-product-capability). This draft removes no data.

## Research context and limits

[Czerwinski, Horvitz and Wilhite's CHI 2004 diary study](https://www.microsoft.com/en-us/research/publication/a-diary-study-of-task-switching-and-interruptions/) examined how information workers interleave tasks and the difficulty of switching among them. [Shakeri Hossein Abad and colleagues' RE 2017 paper](https://arxiv.org/abs/1707.01921) proposes visual/narrative support for recalling requirements decisions when resuming work. These are relevant research directions, not evidence that the proposed StateCarry screens improve performance or that this owner has a particular clinical condition.

[NN/g's recognition-versus-recall guidance](https://www.nngroup.com/articles/recognition-and-recall/) supports presenting recognizable content instead of requiring users to generate all questions from memory. The StateCarry-specific design inference is to prepare connected answers to the owner's recurring questions. It does not justify displaying every historical detail or hiding the current action's necessary rationale behind many nested panels. This pass reviewed publication abstracts and interface guidance, not the full methods or a new experiment.

For the clarification about terminology and depth, [NN/g's progressive-disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/) distinguishes essential options from secondary ones and cautions against excessive disclosure levels. [GOV.UK's details guidance](https://design-system.service.gov.uk/components/details/) says not to hide information most users need. [NN/g's information-scent guidance](https://www.nngroup.com/articles/information-scent/) explains why labels should reveal what answer a destination offers, using words the audience understands. [Task-scenario guidance](https://www.nngroup.com/articles/task-scenarios-usability-testing/) informs the no-coaching prototype check. These sources inform the proposed split; they do not validate a universal three-layer limit or the example above.

## Current decision point

The initial "what did you expect to finish before closing the app?" question has been answered: its concrete answer depends on unfinished work, completed work and pending delegation, while the common outcome is a next choice understood in the overall direction. Do not ask it again or force a single uniform output.

On 2026-09-16 KST the owner approved the project-oriented Home/Project flow and explicitly authorized a fresh UI implementation. Home supports a choice across registered projects; Project explains the selected work, its next decision and its relation to the project purpose. The [implementation milestones](project-ui-implementation.md) record that approval and the concrete delivery scope. The return-content contract still governs real explanations, essential finish criteria, explained evidence and separate original inspection. Hands-on comparison, unassisted human comprehension and real-work-return acceptance remain to be observed; implementation authorization does not mark those outcomes complete. Installer delivery remains a later milestone.
