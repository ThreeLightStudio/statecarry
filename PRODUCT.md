# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user is the owner (confirmed 2026-09-26): a developer working across many local projects under one projects root, returning to them after interruptions or absences, often with work delegated to coding agents (Codex first). Public source is released under MIT (ThreeLightStudio/statecarry), but UI decisions are owner-first; no general-audience release commitment is recorded.

## Product Purpose

StateCarry helps the user return to a project, understand where it stands, and choose what to do next. It reconstructs project context — current work, purpose, evidence, delegated request/result — so returning does not require re-reading conversations or raw records. Success is a grounded next decision with enough context to act or deliberately defer, checkable against the project's intended direction.

## Positioning

Project-return understanding built from durable project records and repository evidence. Unlike session-chat tools, remembering a conversation must not be the price of understanding a project. Unlike generic AI dashboards, every element must earn its place through a user decision. The interface keeps user acceptance, deterministic observation, agent report, and suggestion visibly distinct.

## Operating Context

- Local macOS desktop app: Electrobun host plus a loopback HTTP/SSE server; the React SPA runs in both browser (source mode) and the packaged desktop app.
- Projects live under a user-chosen projects root on disk; Git working-tree observations are first-class evidence.
- Codex is the first supported execution/analysis integration; OpenRouter is an analysis-agent alternative with usage-exhaustion failover.
- Recurring return situations: leaving during unfinished work, leaving after finishing work, waiting on delegated results.

## Capabilities and Constraints

- Home Focus: up to three owner-chosen Focus projects; recency is not priority; a recommended return choice appears only when the behavior contract supplies a reason.
- Project screen responsibilities: identity, direction, current work and next action, supporting context, other work.
- Explanation layers: default explanation, specific-question answers, explained evidence; original records open only through explicit named inspection. Raw AI replies, transcripts, logs and payloads never leak into routine explanation.
- Evidence statuses (reported / checked / owner-accepted) stay distinct; observations and suggestions never silently rewrite owner intent.
- Local-first (confirmed constraint, 2026-09-26): all project data stays on-device in local storage behind a loopback server; no cloud sync, no telemetry.
- Terminology is governed by docs/ux-writing.md; response language defaults to English.

## Brand Commitments

- Name: StateCarry. License: MIT, Copyright (c) 2026 ThreeLight Studio. Repository: ThreeLightStudio/statecarry.
- Voice: explain for a reader who does not know the project's internal terms or remember its history (owner requirement, 2026-09-16). No fabricated claims, invented evidence or manufactured backlog.

## Evidence on Hand

- Owner-reported return experiences and raw-data-burden feedback: docs/problem-definition.md.
- Behavior contract: docs/product-behavior-contract.md. UI/UX contract: docs/ui-principles.md. Copy rules: docs/ux-writing.md.
- Research directions only (Czerwinski et al., CHI 2004; Shakeri Hossein Abad et al., RE 2017; NN/g guidance) — they inform the design, they do not validate the product.
- No testimonials, benchmarks or customer claims exist; future work must not fabricate any.

## Product Principles

1. The next decision is the product: every surface answers what to do now, why it matters, and what would finish it.
2. Interpretation over raw records: explanations are prepared for the decision; original inspection is deliberate and named.
3. Evidence keeps its source: reported, checked and accepted stay distinct; observation never becomes acceptance.
4. Fewer, stronger choices: at most about three meaningful choices per state; disclosure is organized by question, not by depth.
5. Local-first trust: user data stays on-device; state preservation on return is correctness, not polish.

## Accessibility & Inclusion

WCAG 2.1 AA is the aspirational standard for the UI (confirmed 2026-09-26): contrast, visible focus, keyboard operability and labeled controls are audit-relevant. Explanations must remain comprehensible to a reader without knowledge of internal project vocabulary.
