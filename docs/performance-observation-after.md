# Performance after: persisted read and incremental project observation

Status: implementation and local before/after measurement captured on 2026-09-19 KST.

This document records the P0 performance change made after
[`performance-baseline.md`](./performance-baseline.md). The existing baseline remains the
historical AS-IS record. The implementation keeps the existing
`UI → Presentation → Core → Adapter` architecture and changes the responsibilities inside the
Core boundary so saved-state reads, repository observation and semantic analysis are separate
operations.

## 1. Problem definition

The previous read path treated “show me the current saved project” as “inspect the project folder
again.” That made ordinary project-list reads, project-page entry, foreground return and profile
changes pay for Git commands, source inventory traversal and selected-file reads.

The target behavior is:

> Start from the last known state immediately, check only whether the project changed, inspect
> deeply only when that cheap check changes, and rerun semantic analysis only when its actual input
> changes.

The architecture improvement is judged primarily by call counts. Wall time is included to show the
user-visible consequence, but model speed and filesystem cache state must not determine whether the
change is considered successful.

## 2. AS-IS structure

Before this change, the principal read path was:

```text
ProjectController.refresh()
  → ProjectGateway.list()
    → Projects.list()
      → Resumes.view()
        → Resumes.input()
          → workspace()
            → StateCarry.inspectWorkspace()
              → GitProjectInspector.inspect()
```

On a project route, `refresh()` then called `inspectWorkingTree()`, which invoked
`Projects.workspace()` and caused another inspection for the current project.

Working-tree semantic analysis used an in-memory map whose signature included
`inventoryFingerprint`. Since that inventory contained mtimes, an unrelated tracked-file mtime
change could invalidate semantic analysis even when the Git diff and selected file contents were
identical. The map disappeared when the app process restarted.

Foreground return called `checkForChanges() → invalidateRead() → refresh(true)`, which exposed a
broad `Checking for changes…` state while the full read path ran.

## 3. AS-IS measurement method

The historical baseline contains the broader measurements. Immediately before implementing this
change, `scripts/performance-observation-benchmark.ts` was also run against the current HEAD so the
same synthetic scenario could be rerun after the change.

The benchmark creates independent dirty Git repositories with 1,000 small TypeScript source files,
one tracked modification and one untracked file. It uses the real `GitProjectInspector`, while the
semantic provider is a deterministic fake that records call count. No live LLM request is made.

The benchmark measures:

- `Projects.list()` for 1, 3 and 5 registered projects;
- `Projects.list()` plus the current-project workspace read;
- event-loop delay while deep inspection runs;
- repeated observation of the same dirty workspace;
- an unrelated tracked-file mtime-only touch;
- a new `StateCarry` instance over the same durable repository state;
- one project-settings save.

Call counts are recorded for probe, deep inspection, semantic analysis and emitted change events.
The benchmark script also keeps an explicit project-list read counter internally; the table below
reports the per-read observation calls that matter architecturally.

## 4. AS-IS numbers fixed before implementation

The pre-change rerun on the same local machine produced:

| Scenario                                              |                  AS-IS result |
| ----------------------------------------------------- | ----------------------------: |
| 1-project `Projects.list()` median                    |                      86.25 ms |
| 3-project `Projects.list()` median                    |                     253.61 ms |
| 5-project `Projects.list()` median                    |                     470.99 ms |
| Deep inspection calls per 1/3/5-project list          |                     1 / 3 / 5 |
| 1-project list + current workspace                    | 170.06 ms, 2 deep inspections |
| 3-project list + current workspace                    | 426.56 ms, 4 deep inspections |
| 5-project list + current workspace                    | 544.80 ms, 6 deep inspections |
| Synchronous deep-inspection wall time                 |                     193.00 ms |
| 0 ms timer observed after synchronous deep inspection |                     193.48 ms |
| First dirty-workspace read                            |         inspect 1, semantic 1 |
| Identical second dirty-workspace read                 |         inspect 2, semantic 1 |
| After unrelated mtime-only touch                      |         inspect 3, semantic 2 |
| After new Core instance over same repository          |         inspect 4, semantic 3 |
| One project-settings save                             |               2 change events |

These numbers agree with the historical baseline: project-list cost grew approximately linearly
with project count, the current project could be inspected twice in one refresh cycle, the
inspection blocked the Node event loop, mtime-only inventory changes could wake semantic analysis,
and semantic cache reuse did not survive restart.

## 5. Implemented structure changes

### Persisted read model

`Projects.list()`, `Resumes.view()` and `Projects.workspace()` now consume saved state. They do
not invoke Git or filesystem observation.

`resume.workspaceBefore` and `resume.workspaceAfter` remain immutable evidence for the Overview
generation that created them. Current workspace state is represented separately by a
`ProjectObservation` entity.

For installations created before `ProjectObservation` existed, a valid
`resume.workspaceAfter` is used as a read-only last-known fallback. It is not overwritten or
relabelled as newly checked. The first explicit observation creates the dedicated current
observation record.

### Durable current observation

The generic SQLite entity store now persists:

```ts
ProjectObservation {
  workId
  checkedAt
  probeKey
  inspectionKey
  semanticKey
  snapshot
}
```

`probeKey` identifies the cheap Git currentness check. `inspectionKey` identifies the complete
deep observation. `semanticKey` identifies only evidence that is actually relevant to
working-tree semantic reconstruction.

### Cheap probe before deep inspection

`GitProjectInspector` now exposes an asynchronous probe that checks repository root, branch, HEAD
and a Git porcelain working-tree fingerprint. It does not recursively inventory project source
files.

Core observation now follows:

```text
probe
  ├─ same probeKey → reuse ProjectObservation
  └─ changed probeKey
       → async deep inspect
       → persist ProjectObservation
       → compare semantic input
```

The production observation path uses asynchronous Git process calls and asynchronous filesystem
operations for deep inspection so the local HTTP/SSE event loop can continue running while the
inspection is pending.

The older synchronous `inspect()` implementation remains available for compatibility with
explicit synchronous safety checks outside the foreground observation coordinator.

### Semantic dependency key and durable analysis

Working-tree analysis no longer uses the complete inventory fingerprint as semantic cache identity.
The evidence key is built from values passed into semantic reconstruction, including:

- branch and HEAD;
- changed files and counts;
- tracked diff preview;
- additions/deletions/untracked count;
- selected relevant file paths and content hashes.

Unrelated inventory mtime metadata is excluded.

Analysis results are stored as:

```ts
WorkingTreeAnalysisRecord {
  workId
  semanticKey
  outputLanguage
  result
  generatedAt
}
```

This replaces the process-only `Map` as the source of cache reuse. In-flight requests are still
deduplicated in memory, while completed results survive process restart in SQLite.

### Language analysis without repository observation

Output-language changes use the latest persisted observation directly. They may create or reuse a
semantic result for the new language, but they do not run a Git probe or deep repository
inspection.

### Narrower change events

The performance-sensitive paths now emit typed topics:

```text
profile
sources
observation
working-tree-analysis
overview
```

Project profile saves emit one `profile` event. Observation and semantic-analysis completion emit
their own topics. The presentation controller responds to these events with persisted reads and no
broad `checkingCurrent` invalidation.

## 6. TO-BE execution flow

### Project list and project-page entry

```text
UI read
  → Presentation
    → Core persisted read
      → SQLite / in-memory repository rows

background currentness check for active project
  → async cheap probe
    ├─ unchanged → stop
    └─ changed
         → async deep inspection
         → persist observation
         → semantic key comparison
           ├─ unchanged → reuse durable analysis
           └─ changed → semantic analysis → persist result
```

The project page can render the last known working-tree result before the background currentness
check completes.

### Foreground return

```text
keep current UI
  → reread persisted project registrations
    → no Git/filesystem observation
  → observe current project in background
    → cheap probe
      ├─ unchanged → no UI checking state, no deep inspect, no LLM
      └─ changed → update only current observation and dependent semantic result
```

### Restart

```text
open app
  → read ProjectObservation + WorkingTreeAnalysisRecord
  → render saved state
  → background probe
    └─ unchanged → deep inspect 0, semantic analysis 0
```

## 7. TO-BE benchmark results

Final benchmark run: 2026-09-19 KST, Node v26.0.0.

| Scenario                                                    |                                TO-BE result |
| ----------------------------------------------------------- | ------------------------------------------: |
| 1-project `Projects.list()` median                          |                                     0.06 ms |
| 3-project `Projects.list()` median                          |                                     0.17 ms |
| 5-project `Projects.list()` median                          |                                     0.19 ms |
| Probe calls per 1/3/5-project list                          |                                   0 / 0 / 0 |
| Deep inspection calls per 1/3/5-project list                |                                   0 / 0 / 0 |
| 1-project list + persisted current workspace                |                 0.09 ms, 0 deep inspections |
| 3-project list + persisted current workspace                |                 0.16 ms, 0 deep inspections |
| 5-project list + persisted current workspace                |                 0.21 ms, 0 deep inspections |
| Cheap probe median on current StateCarry repository         |                                    20.45 ms |
| Async deep-inspection wall time                             |                                   114.51 ms |
| 0 ms timer observed while async deep inspection was pending |                                     0.78 ms |
| First observation of dirty synthetic workspace              |   107.44 ms; probe 1, inspect 1, semantic 1 |
| Unchanged reentry observation                               | 25.53 ms; probe +1, inspect +0, semantic +0 |
| After unrelated mtime-only touch                            |           probe +1, inspect +0, semantic +0 |
| Restart persisted-state read                                |            0.18 ms; inspect +0, semantic +0 |
| Restart currentness observation                             | 25.16 ms; probe +1, inspect +0, semantic +0 |
| One project-settings save                                   |                        1 typed change event |

The list timings are intentionally interpreted together with call counts. The sub-millisecond
numbers come from an in-process synthetic benchmark and are not a packaged-app SLA. The significant
property is that list and workspace reads perform zero probes and zero deep inspections regardless
of the registered project folders.

## 8. Before/after comparison

| Measurement                                         |                    AS-IS |                                 TO-BE |
| --------------------------------------------------- | -----------------------: | ------------------------------------: |
| `Projects.list()` deep inspection calls             |            1 per project |                                 **0** |
| 1-project list median                               |                 86.25 ms |                           **0.06 ms** |
| 3-project list median                               |                253.61 ms |                           **0.17 ms** |
| 5-project list median                               |                470.99 ms |                           **0.19 ms** |
| 5-project list + current workspace deep inspections |                        6 |                                 **0** |
| 5-project list + current workspace wall time        |                544.80 ms |                           **0.21 ms** |
| Deep inspection event-loop delay                    |                193.48 ms | **0.78 ms** on async observation path |
| Identical reentry deep inspection delta             |                        1 |                                 **0** |
| Identical reentry semantic-analysis delta           | 0 after memory-cache hit |              **0 with durable reuse** |
| Unrelated mtime-only semantic-analysis delta        |                        1 |                                 **0** |
| Restart semantic-analysis delta                     |                        1 |                                 **0** |
| Settings-save change events                         |                        2 |                 **1 `profile` event** |

## 9. Call-count change

The same synthetic dirty-workspace sequence shows the dependency separation directly:

| Stage                                  | AS-IS probe | AS-IS deep inspect | AS-IS semantic | TO-BE probe | TO-BE deep inspect | TO-BE semantic |
| -------------------------------------- | ----------: | -----------------: | -------------: | ----------: | -----------------: | -------------: |
| First observation                      |           0 |                  1 |              1 |           1 |                  1 |              1 |
| Identical second return, cumulative    |           0 |                  2 |              1 |           2 |                  1 |              1 |
| mtime-only unrelated touch, cumulative |           0 |                  3 |              2 |           3 |                  1 |              1 |
| restart + unchanged check, cumulative  |           0 |                  4 |              3 |           4 |                  1 |              1 |

This is the main architectural result: repeated currentness checks can increase probe count without
increasing deep-inspection or semantic-analysis count.

## 10. User-experience meaning

Returning to an unchanged project no longer changes the page into a broad
`Checking for changes…` state. The controller keeps the existing saved project and working-tree
view visible while it performs the current-project probe.

In the measured unchanged-return scenario, the entire observation completed in about 25.5 ms and
did not deep-inspect the repository or invoke the semantic provider.

On restart, the saved observation and semantic reconstruction are available before currentness is
checked. The benchmark read took about 0.18 ms, after which the background probe took about 25.2 ms
without deep inspection or semantic analysis.

Profile edits now refresh persisted application state without touching Git/filesystem observation.
Language changes reuse the same repository observation and only resolve the language-dependent
semantic result.

## 11. Acceptance conditions

### Acceptance A — unchanged reentry

> 변화 없는 프로젝트로 복귀할 때 기존 상태가 즉시 읽히고, deep inspection 0회, LLM semantic analysis 0회여야 한다.

**Passed.**

Focused Core tests establish that the saved workspace and analysis can be read with zero probe,
zero deep inspection and zero semantic calls. A subsequent unchanged reentry performs one cheap
probe while deep inspection and semantic-analysis counters remain unchanged.

The foreground UI test also verifies that returning from `visibilitychange` performs one cheap
persisted project-list reread without showing the broad workspace checking status, then observes
only the current project. This keeps external project deletion/registration changes visible without
restoring the old `N`-project inspection path.

### Acceptance B — unchanged restart

> 앱을 재시작해도 마지막 observation과 semantic analysis가 복원되며, semantic key가 동일하다면 기존 working-tree 분석을 다시 생성하지 않아야 한다.

**Passed.**

The restart test uses the production `SQLiteRepository`: it writes a dirty observation and
semantic-analysis record, closes SQLite, reopens the same database with a new Core instance, reads
the prior working-tree analysis immediately, then performs an unchanged probe. Deep-inspection and
semantic-analysis call counts do not increase.

## 12. Validation

Focused tests cover:

- passive list/workspace reads;
- unchanged probe reuse;
- semantic-key independence from inventory-only change;
- output-language semantic analysis without repository observation;
- SQLite close/reopen durability;
- one-event profile settings;
- real Git mtime-only probe stability;
- synchronous/async deep-inspector result parity;
- foreground return without broad checking;
- existing project controller and workspace behavior.

Final repository-wide validation is recorded in the implementation handoff after
`format:check`, `lint`, `check`, focused tests and `verify` complete.

## 13. Measurement environment and limits

The environment matches the historical local baseline:

| Item           | Value        |
| -------------- | ------------ |
| Machine        | Apple M4 Pro |
| Architecture   | arm64        |
| Logical CPUs   | 12           |
| Memory         | 48 GiB       |
| OS             | macOS        |
| Benchmark Node | v26.0.0      |

The benchmark uses generated local repositories and a fake semantic provider. It therefore measures
architecture and invocation count without spending a live model request or mixing provider
variability into the comparison. Actual model latency is intentionally not reported.

The list benchmark uses an in-memory repository so its absolute sub-millisecond values should not
be read as end-to-end Electrobun latency. Restart durability is separately verified against the
production SQLite repository.

The asynchronous deep-inspection wall time varies with filesystem cache state. Its architectural
target is event-loop availability; in the final run the deep operation took 114.51 ms wall time
while the already-scheduled 0 ms timer ran after 0.78 ms.

## 14. Remaining risks and follow-up work

- The compatibility `StateCarry.inspectWorkspace()` API remains synchronous and is still used by
  explicit continuation safety checks. The foreground observation coordinator uses the new async
  path, but continuation preparation can still block the local service while it performs its
  safety inspection.
- The cheap probe currently invokes Git and takes about 20–25 ms locally. A filesystem watcher or
  longer-lived repository status service could reduce repeated probe cost, but neither is required
  for the P0 architecture fix.
- The current coordinator observes the active project on startup/foreground return. It is not a
  generalized dependency graph or all-project watcher.
- Completed semantic-analysis records are retained by semantic key until project deletion. A future
  bounded retention policy may be useful if a project accumulates many distinct dirty states or
  language variants.
- Packaged Electrobun click-to-render timing and real-provider latency remain separate follow-up
  measurements.

No model swap, filesystem watcher, controller-wide rewrite, UI redesign or generalized dependency
engine was introduced in this change.
