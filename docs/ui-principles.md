# UI and interaction principles

This document is the durable UI/UX contract for StateCarry. It defines how product intent becomes information architecture, interaction, component composition and visual treatment, and how future UI changes are reviewed before they are accepted.

The upstream product behavior contract is [product-behavior-contract.md](product-behavior-contract.md). Use that contract to determine which work, decision, interruption, dependency, completion or delivery state should be shown. Use this document to determine how that behavior becomes a coherent interface. Use [ux-writing.md](ux-writing.md) alongside it for labels, statuses, helper text and other user-facing copy.

Use this document before changing layout, navigation, hierarchy, interaction, loading behavior, component composition or visual emphasis.

The purpose is not to freeze the current screenshots. It is to preserve the product logic that makes the interface understandable while allowing the implementation and visual system to evolve.

## Product sentence

**Return to a project, understand where it stands, and choose what to do next.**

Every primary surface should help the user do one of these things:

1. choose the project worth returning to;
2. recognize the selected project's direction;
3. understand the current decision;
4. inspect supporting context when it changes that decision;
5. start, correct, pause, accept or deliberately defer the next action.

A UI element that cannot explain which user decision it supports is a removal or relocation candidate.

## Design order

Do not begin a UI change with colors, borders, radius, typography or component polish.

Work in this order:

1. **Product intent** — What user problem is this surface solving?
2. **User task** — What should the user be able to decide or do here?
3. **Information architecture** — Which information belongs on this surface, and in what order?
4. **Interaction and state** — What happens on entry, action, loading, failure, stale data, completion and return?
5. **Component composition** — Which components express that hierarchy without adding competing concepts?
6. **Design tokens** — Apply spacing, type, color, borders, radius and motion consistently.
7. **Rendered UI** — Inspect the actual desktop/mobile result, not only JSX or component names.
8. **Visual and interaction evaluation** — Verify that the rendered screen still communicates the intended task and hierarchy.

A visual theme pass happens only after the structure and behavior are correct.

## Structural audit before visual polish

Before adjusting aesthetics, perform a structural UI audit.

Check these layers in order:

### Product intent

State the surface's job in one sentence. If the sentence contains several unrelated jobs, split responsibilities or remove secondary content.

### Task

Name the primary user decision. The interface should make that decision visible without requiring the user to reconstruct prior sessions or understand StateCarry internals.

### Information architecture

Verify that primary, supporting and optional information are visibly different.

Do not preserve an element merely because it existed before. Use **keep / simplify / move / remove** as the default inventory.

### Interaction and state

Loading, empty, stale, disconnected, failed, completed and partial states are designed states. They are not temporary placeholders to be solved later.

Preserve valid previous information while checking for newer information when possible.

### Heuristic review

Ask:

- Can the user tell where they are?
- Can the user tell what matters now?
- Can they predict what each visible action will do?
- Is a destructive or irreversible action clearly distinct?
- Does optional evidence stay optional?
- Is the UI showing system implementation instead of user meaning?
- Are two components competing to answer the same question?

### Generative-UI drift review

Repeated AI-assisted edits can cause hierarchy, ordering and vocabulary to drift even when each local change looks reasonable.

After a sequence of edits, re-check the whole surface for:

- duplicated headings or concepts;
- inconsistent vocabulary;
- a secondary card becoming more visually prominent than the primary decision;
- old controls surviving after their responsibility moved elsewhere;
- excessive badges, cards, pills or explanatory copy;
- unrelated patterns introduced because they are common in generated dashboards.

Do not treat accumulated UI as intentional design merely because every individual change had a reason.

## Avoid AI-generated dashboard defaults

StateCarry should not look like a generic AI dashboard.

Common failure modes include:

- a card for every piece of data;
- several equally weighted status boxes;
- decorative metrics without a user decision;
- prominent AI-generated summaries competing with the user's work;
- excessive pills, badges, gradients and borders;
- generic `Overview / Insights / Activity / Recommendations` sections with unclear responsibility;
- a sidebar that becomes a second copy of the main content;
- dense controls added because space is available rather than because the task requires them.

A component must earn its place through the user task.

Prefer fewer, stronger regions over a grid of weakly related cards.

## Screen responsibilities

### Home

**Job:** help the user decide which registered project to return to.

Home is not an all-project dashboard.

The primary model is **Home focus**:

- the user explicitly chooses up to three Focus projects;
- StateCarry does not reorder Focus projects automatically; it may mark one Project as a recommended
  return choice when the product behavior contract supplies a reason;
- recency is not priority;
- creating a project does not automatically place it in Focus;
- when Focus is full, replacement is an explicit user choice.

A Focus card should be recognizable before it is analytical. Project identity, optional visual identity and a compact state are enough.

All-project exploration belongs in Projects, not duplicated on Home.

### Projects

**Job:** explore registered projects and manage Home focus.

Projects may provide search when the project count makes it useful. It should not become a second dashboard.

Project cards open the project directly. Focus management is secondary to opening and recognizing projects.

Disconnected projects are a distinct section because their available actions differ from active projects.

### Project

**Job:** help the user understand the selected project's present position and choose one meaningful next action.

The primary hierarchy is:

1. **Project identity**
2. **Direction**
3. **Current work**
4. **Current state → Still to check → Next**
5. **Context**
6. **Other work**

These are responsibilities, not a requirement that every item be a card.

#### Project identity

The project name is the stable identity.

Optional icon and cover imagery can improve recognition but must not become required data. Missing imagery always has a usable fallback.

A cover is presentation, not evidence or project state.

#### Direction

Direction is compact orientation, not the main action.

Use the current goal when available; otherwise use the project purpose. Do not create a second independent direction model.

Direction should be visually quieter than Current decision. It must not look like an alert, primary card or competing call to action.

The project purpose remains a durable identity statement distinct from the current goal. It may appear as quiet project context where useful, while Project settings remains the editing surface.

#### Current work and next action

The current Work is the strongest region on the Project screen. Its concrete Work title is the largest
textual heading in the normal Project reading flow.

It answers: **What am I in, where does it stand, and what should I do next?**

Core `ProjectNow` is authoritative for which Work, notice and next action appear here. Presentation and
UI must not create a parallel priority resolver from raw Git state, generated candidates or recency.

The default state should expose the smallest set of meaningful actions. Aim for no more than three meaningful choices in one state; place infrequent recovery or management actions under progressive disclosure when appropriate.

Read the default Work body in this order: one current-state sentence, one decision-relevant uncertainty
when needed, then one `Next` sentence. Show one primary action and at most two ordinary secondary
actions. Do not invent an executable next step for accepted, completed or unclear work. Waiting Work
may show one independent low-restart-cost alternative when the Core resolver supplied it.

Generated Resume candidates and working-tree groups are Work proposals or evidence until they are
matched to durable Work. If migration has no confirmed current Work, show the proposal as a choice and
persist it only after the user selects it.

Detailed execution, change review, result review and discussion are modes inside the current Work.
Entering a mode does not replace the Project's durable current Work. Leaving it returns to the same
ProjectNow surface.

Discussion is attached to the current task. Opening or asking in that discussion does not change the
goal, accept a result, stop work or start external execution. Keep the discussion with that task when
the user leaves and returns. If the project changes, keep earlier answers readable as answers from
their earlier basis and require the user to continue against the current state before asking more.

Project detail uses one reading column with a compact project name and direction. The current work
is a narrative surface, not a large enclosing card. Its ordinary choices are stacked: continue or
review, discuss, and stop. Put the short current understanding between the narrative and choices;
keep original records behind deliberate inspection.

Discussion replaces the work's ordinary choices and evidence controls while it is open. Keep the
work title and a short context sentence, then give the conversation the primary position. Closing
discussion returns to the same work. Repository-derived work uses this same flow and retains the
selected work group across navigation. A stopped state puts the treatment of remaining changes
first and still allows discussion without restoring the task.

Stopping a task records a task decision only. It does not revert project files. When repository
changes remain, make their treatment a separate choice: keep them and move on, or review them before
deciding. A change set the user explicitly chose to keep should not become the default current
decision again until the observed repository state changes.

#### Context

Context exists to support the current decision, not to compete with it.

Examples include:

- working-tree changes;
- overview freshness/update;
- basis/source information;
- limits that could change the user's decision.

Working-tree analysis is supporting evidence. It is not a parallel top-level task planner.

When repository changes become the current decision, present the inferred work in the same interaction
model as a task: explain what the work appears to be, where it stands, what outcome would finish it,
what is still uncertain, and what the user can do next. Git counts, diff size, branch, commit, file
lists and raw diffs belong behind deliberate review unless one short fact materially changes the
decision.

When one working tree contains several reconstructed work groups, require the user to select the
piece of work they want to make current before offering continuation. A scoped handoff includes only
the selected work and treats the remaining uncommitted changes as out of scope. The selection should
read as choosing work, not filtering files.

If StateCarry cannot explain the current changes as coherent work, say that in user terms and route
the user toward review or discussion. Do not surface internal reconstruction terminology on the
primary path.

Context should remain readable on demand. Technical detail should become deeper only when the user deliberately asks for it.

#### Other work

Other work is secondary to the current decision. Keep it lower in the hierarchy and collapsed when that reduces competition.

Selecting another task changes the Current decision rather than opening a competing detail model.

### Settings

Global Settings contains app-wide behavior and integration availability.

Project-specific data belongs in Project settings.

Do not let Global Settings become another project-management dashboard.

Project settings owns project identity, response language, source scope, Focus membership and project lifecycle controls. Add project uses the same response-language preference, defaulting to English. Saving it does not regenerate existing results.

## Choice count and action hierarchy

For an ordinary state, prefer at most three meaningful visible choices.

This is not a rigid button-count rule. It is a decision-load rule.

A good default pattern is:

- one primary action;
- one useful secondary action;
- one optional escape or `More actions` disclosure.

Do not expose several equivalent-looking actions and ask the user to infer priority from labels.

Native disclosure such as `details` is preferable to inventing another menu when the extra actions are infrequent and local.

## Progressive disclosure

The default view should contain enough explanation to make the current decision without opening original records.

Use depth in this order:

1. current situation and decision;
2. explained basis and meaningful limits;
3. original record or raw technical inspection.

Do not make `Details`, `Why?` or `Evidence` unexpectedly reveal raw AI replies, transcripts, command logs or diagnostic payloads.

If the user needs several nested expansions to understand the current decision, improve the default explanation instead of adding another layer.

## Loading and progressive startup

Perceived responsiveness is part of correctness.

Do not wait for all project analysis before rendering the application.

The intended startup sequence is:

1. render the application shell;
2. find lightweight project registrations;
3. render recognizable project identity immediately;
4. hydrate saved project state in the background;
5. load project-specific contextual analysis independently.

Loading indicators should preserve the final layout where practical. Prefer scoped skeletons or named loading states over a blank screen followed by a sudden full render.

The UI should distinguish:

- finding projects;
- loading project details;
- checking current state;
- generating or updating an overview;
- checking the working tree.

These are not interchangeable operations.

When valid saved information exists, keep it visible while checking newer state instead of replacing it with a full-page loader.

## Visual hierarchy

Visual weight must correspond to product responsibility.

The strongest visual treatment belongs to the user's current decision, not to metadata, generated analysis or settings.

Use background fills, accent borders, large cards and saturated badges sparingly. A supporting concept should not receive a stronger container than the decision it supports.

Prefer whitespace and typographic hierarchy before adding another border or colored surface.

If several adjacent components all use borders, backgrounds and headings, ask whether they are actually separate user concepts.

## Typography

The type identity is tokenized as `--font-sans` and `--font-mono`. Do not introduce additional families or hard-coded font stacks.

- The sans stack carries interpretation: explanations, narrative surfaces and interface copy.
- The mono stack marks deterministic observation quoted from the repository: file paths, commit references, diff counts and similar evidence. A fact woven into a prose sentence stays sans.

## Project imagery

Project imagery is for recognition.

- Icon: compact identity across Home, Projects and Project.
- Cover/banner: optional visual identity.
- Missing assets use deterministic product fallbacks.
- Selected local images are copied into StateCarry-managed storage; project metadata stores an opaque asset reference rather than the original absolute path.

Home Focus cards use a fixed banner region. A custom image is centered and scaled to that region's height without changing the card's layout height.

The Project cover is a separate full-width visual band between the app shell and project content. It may crop vertically while preserving full content width, with the crop centered vertically.

Project imagery must never alter task priority, source meaning, state validity or action availability.

## Shell and navigation

The shell should remain smaller than the product content.

Persistent navigation exists to move between responsibilities, not to mirror every project or action.

The left rail should stay compact. Project lists belong in Projects rather than becoming persistent sidebar navigation.

Avoid multiple stacked horizontal navigation bars. Route context, beta state, transient status and feedback should share a compact header when possible.

The page title inside the content remains the semantic title of the current surface.

External promotional links should not displace core navigation.

## Design system means more than tokens

The StateCarry design system includes:

- persistent information architecture;
- screen responsibilities;
- interaction principles;
- loading and recovery behavior;
- progressive disclosure rules;
- action hierarchy;
- terminology;
- visual tokens.

A UI can use the correct colors and components and still violate the design system if it changes these interaction or IA principles.

## State preservation and refresh

Project decisions use stable work identities independently of the evidence version. A renamed or
regrouped analysis must not delete an earlier discussion. If correspondence is ambiguous, retain the
earlier discussion and ask the user to connect it to current work.

Reviewing a request, preparing it, sending it, receiving an agent report, comparing the project,
and accepting the result are separate transitions. Once a request is prepared, its exact reviewed
text replaces the editable request form. Editing again requires a new scope confirmation. A result
waiting for review takes priority over another execution request.

Leave decisions apply to explicitly selected change sections, including the staged or unstaged
layer. Unrelated changes do not erase them. Execution and copying a prepared request must validate
the reviewed scope on the server; a browser's last observation alone is insufficient.

An externally executed request can have a user-recorded result. Keep that report distinct from a
Codex report and from current project observations. Neither report automatically accepts the work.

A refresh must not casually erase the user's orientation.

Preserve:

- the selected project;
- the selected task when still valid;
- unsaved input under the existing draft rules;
- previously valid overview content while a background check runs;
- disclosure state where it materially supports return.

Do not automatically regenerate AI output merely because the app became visible again.

Current-state checks and overview generation are separate operations.

## Evidence versus decisions

StateCarry can observe evidence and suggest an interpretation, but the interface must preserve ownership.

Distinguish:

- user choice and acceptance;
- deterministic observation;
- agent report;
- StateCarry suggestion.

Do not make AI confidence, recency or successful tool output visually equivalent to user acceptance.

A current repository state can be stronger evidence of implementation than an older conversation plan. Present-state analysis may be more useful for resumption than reconstructing every historical step.

## Change protocol

When changing an existing surface:

1. Write the surface job and primary user decision.
2. Inventory current elements as keep / simplify / move / remove.
3. Identify which state transitions the change affects.
4. Modify IA and interaction before visual tokens.
5. Re-read [ux-writing.md](ux-writing.md) for any copy changes.
6. Inspect the rendered result at representative desktop and narrow widths.
7. Re-run the structural audit across the whole surface, not only the changed component.
8. Run focused tests and repository verification required by [AGENTS.md](../AGENTS.md).

Do not solve ambiguity by adding another card, label or explanatory paragraph until checking whether an existing concept should instead be removed, merged or reordered.

## Acceptance checklist

Before accepting a UI change, answer yes to the relevant questions:

- Can the user tell where to go from this screen?
- After entering a project, is one current decision visually dominant?
- Does supporting information stay subordinate to that decision?
- Are there no more visible choices than the state reasonably needs?
- Does every visible element have a named task or reason?
- Are loading, empty, stale, failure and completed states deliberate?
- Does the UI preserve useful saved information during background checks?
- Is technical evidence behind deliberate disclosure?
- Is terminology consistent with [ux-writing.md](ux-writing.md)?
- Has hierarchy/order/vocabulary drift been checked after cumulative edits?
- Does the interface avoid generic AI-dashboard patterns?
- Was structural correctness reviewed before visual theme work?
- Does the rendered desktop/mobile result match the intended hierarchy?

If the answer is no, fix the structure before polishing the theme.
