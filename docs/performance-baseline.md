# Performance baseline: project observation and refresh

Status: baseline captured on 2026-09-18 KST before observation/read-model architecture changes.

This document records the current performance cost of project observation and refresh paths before changing their architecture. The goal is to keep a reproducible before/after record: measure the present bottlenecks, connect them to visible interaction delays, then rerun the same scenarios after the observation pipeline is changed.

The baseline intentionally uses only this repository and generated synthetic Git repositories. It does not read the owner's StateCarry database, Codex conversation records, or private analysis history, and it does not make live model calls.

## Why this baseline exists

The current implementation couples a read of project state with live workspace inspection:

1. `ProjectController.refresh()` requests the full project workspace.
2. `Projects.list()` renders every active project through `Resumes.view()`.
3. `Resumes.view()` calls `input()`, which calls `workspace()` and then `StateCarry.inspectWorkspace()`.
4. `GitProjectInspector.inspect()` synchronously runs Git commands, recursively inventories source files, stats files and reads selected file contents.
5. When the current route is a project, `ProjectController.refresh()` separately calls `inspectWorkingTree()`, causing another workspace inspection for that project.

Relevant implementation:

- [`packages/presentation/src/project-controller.ts`](../packages/presentation/src/project-controller.ts)
- [`packages/core/src/projects.ts`](../packages/core/src/projects.ts)
- [`packages/core/src/resumes.ts`](../packages/core/src/resumes.ts)
- [`apps/server/src/adapters/project-inspector.ts`](../apps/server/src/adapters/project-inspector.ts)

This means a UI refresh is not a cheap read of saved application state. It can synchronously inspect every registered project before the local server can answer.

## Measurement environment

The local baseline was recorded with:

| Item                             | Value            |
| -------------------------------- | ---------------- |
| Machine                          | Apple M4 Pro     |
| Architecture                     | arm64            |
| Logical CPUs                     | 12               |
| Memory                           | 48 GiB           |
| OS family                        | macOS (`darwin`) |
| Node used by the benchmark shell | v26.0.0          |

The repository supports Node `>=24.14.1`; the benchmark shell happened to use Node 26.0.0. These numbers are therefore a local architectural baseline, not a release-environment SLA or a cross-machine benchmark.

The synthetic repositories contained small TypeScript files, one tracked modification and one untracked file. Repositories with 100, 1,000 and 6,000 source files were generated. `GitProjectInspector.inspect()` was warmed once and then measured repeatedly. The 100- and 1,000-file cases used five timed samples; the 6,000-file case used three. With these small sample counts, the reported p95 is directional and is effectively the highest observed sample in several cases.

## Baseline 1: one workspace inspection

`GitProjectInspector.inspect()` is synchronous and performs Git process execution plus filesystem traversal and file reads in the HTTP server process.

| Repository                           |        Median | Highest observed | Selected files | Omitted files |
| ------------------------------------ | ------------: | ---------------: | -------------: | ------------: |
| Current StateCarry repository, clean | **159.93 ms** |        208.20 ms |            120 |           611 |
| Synthetic 100 files, dirty           |      89.08 ms |         98.81 ms |            101 |             0 |
| Synthetic 1,000 files, dirty         |     106.97 ms |        121.13 ms |            120 |           881 |
| Synthetic 6,000 files, dirty         |     143.91 ms |        148.72 ms |            120 |         5,880 |

The current StateCarry repository took about 160 ms for one warm inspection despite having a clean working tree. A clean repository still pays for repository metadata, recent commits, source inventory, file selection and sampled reads.

The cost is not only proportional to dirty diff size. Fixed Git command overhead and bounded source inventory work remain even when there is no uncommitted work to analyze.

### Inspection with resume hints

Resume inspection may reuse file, symbol and term hints from a prior overview. That path can inspect file contents while ranking related files. A separate warm measurement produced:

| Repository                    | Median with hints | Highest observed |
| ----------------------------- | ----------------: | ---------------: |
| Current StateCarry repository |         173.19 ms |        180.79 ms |
| Synthetic 1,000 files         |          90.91 ms |         93.85 ms |
| Synthetic 6,000 files         |         133.38 ms |        133.84 ms |

On these small synthetic files, hints did not become the dominant cost. On the current repository they added a modest amount of work. The important architectural property remains unchanged: this hint-aware file access is synchronous and can occur during what the UI treats as a read.

## Baseline 2: event-loop blocking

To distinguish a slow operation from a server-wide blocking operation, a zero-delay timer was scheduled immediately before `inspect()` and observed after the synchronous call returned.

| Repository                    | `inspect()` wall time | 0 ms timer observed after |
| ----------------------------- | --------------------: | ------------------------: |
| Current StateCarry repository |         **197.22 ms** |             **197.70 ms** |
| Synthetic 6,000 files         |             142.20 ms |                 147.68 ms |

The timer could not run until inspection returned. During this interval the Node server event loop cannot service another request, advance an SSE callback, or execute another timer on that process.

At 60 Hz, 197 ms spans roughly twelve 16.7 ms frame intervals. The renderer is a separate web view and may still paint, but the local application service cannot provide new state during that interval. This distinction matches the observed experience of an interface that remains visible while a setting or state check appears stuck before it resolves.

## Baseline 3: project-list cost grows with project count

`Projects.list()` was measured with independent synthetic 1,000-file Git repositories. The same real `GitProjectInspector` was used for every project. Each list read was repeated three times.

| Active projects | Inspection calls per `Projects.list()` | Median list time | Highest observed |
| --------------: | -------------------------------------: | ---------------: | ---------------: |
|               1 |                                      1 |        101.76 ms |        115.50 ms |
|               3 |                                      3 |        293.57 ms |        297.51 ms |
|               5 |                                      5 |    **497.38 ms** |        565.20 ms |

The list cost is approximately linear in the number of registered active projects because each project is live-inspected while constructing the read model.

This is the central architectural bottleneck. Adding projects increases the cost of unrelated UI refreshes even when the user is viewing or editing only one project.

## Baseline 4: current project causes an additional inspection

The controller performs a full workspace refresh and then asks for the current project's working tree. The benchmark reproduced that sequence as `Projects.list()` followed by `Projects.workspace(currentId)`.

| Active projects | Total inspection calls for list + current project | Observed total |
| --------------: | ------------------------------------------------: | -------------: |
|               1 |                                             **2** |      207.73 ms |
|               3 |                                             **4** |      348.85 ms |
|               5 |                                             **6** |      497.35 ms |

The wall-time samples vary with filesystem cache state, but the call count is deterministic: the current project is inspected once while building the list and once again for the working-tree view.

The architecture therefore performs `N + 1` inspections when a project screen is refreshed, where `N` is the number of active projects.

## Baseline 5: unrelated mtime invalidates semantic working-tree analysis

The working-tree semantic cache signature currently includes both `fileFingerprint` and `inventoryFingerprint`. `inventoryFingerprint` contains source path, size and mtime metadata for the discovered inventory.

The following controlled case was measured:

1. A dirty 1,000-file repository was analyzed once.
2. The same workspace was read again without changes.
3. A separate tracked source file had only its mtime changed. Its contents and Git diff were unchanged.
4. The workspace was read again.

Observed result:

| Check                                           | Result  |
| ----------------------------------------------- | ------- |
| Analysis calls after first read                 | 1       |
| Analysis calls after identical second read      | 1       |
| Analysis calls after unrelated mtime-only touch | **2**   |
| Git diff preview changed                        | No      |
| Changed-file list changed                       | No      |
| Selected-file content fingerprint changed       | No      |
| Inventory fingerprint changed                   | **Yes** |

The semantic analyzer in this benchmark was a deterministic fake so no live model request was made. The result establishes the trigger behavior: an mtime-only inventory change can force another semantic-analysis invocation even though the working-tree diff and selected file contents are unchanged.

Actual Codex analysis latency is intentionally not part of this baseline. In production, every unnecessary cache miss can add external analysis latency on top of the synchronous inspection cost measured here.

## Baseline 6: one project-settings save emits two change events

One `Projects.settings()` call was executed with an event counter.

Observed change events: **2 for one settings save**, both for the same `workId`.

The duplicate is produced because the shared `commit()` helper emits `changed(workId)`, then `settings()` emits it again after `commit()` returns.

The presentation controller conservatively invalidates current state on each change event. Its 150 ms coalescing window can merge some bursts, but an event that arrives while a read is pending can set `readAgain`, so the duplicate event unnecessarily increases invalidation and reread pressure.

## How these costs become UX degradation

The measured latency is directly connected to UI state, not only to background CPU usage.

### Project settings

`ProjectController.mutate()` sets `busyWorkId`, waits for the mutation, then waits for `refresh()` before clearing the busy state. A project-profile edit therefore remains in a busy interaction state while `Projects.list()` live-inspects all active projects.

In the five-project synthetic case, the median list portion alone was about 497 ms before transport, presentation work or any additional current-project inspection. A title, purpose, focus or asset setting does not require live Git inspection, but the current read path pays that cost anyway.

### Change events and currentness

When an SSE change arrives, `ProjectController.invalidateRead()` sets `checkingCurrent: true`. For affected projects, presentation disables editing, decisions and refresh actions while marking them as checking current state.

Because the underlying refresh can synchronously inspect every project, a metadata change can surface as a visible "checking" interval even though no repository fact relevant to that metadata changed.

### Project page refresh

After the full project list read completes, the current project is inspected again for its working-tree card. The user can therefore wait through two inspections of the same project in one refresh cycle.

### Language change

Changing output language calls `setOutputLanguage()`, which starts `inspectWorkingTree()` again when a project page is active. Existing overviews may also be localized through the analysis provider. Repository observation and language presentation are separate concerns, but the current interaction can wake both paths.

### Repeated working-tree analysis

The mtime-only benchmark demonstrates that the semantic cache can be invalidated by repository inventory metadata that did not change the Git diff or selected file contents. When this happens with the real provider, a visually unchanged working tree can return to an analysis/loading state and wait for another model call.

## Structural conclusion

The current performance problem is not primarily a slow model or an insufficient debounce interval. The synchronous observation boundary is attached to broad read and invalidation paths.

The following properties make the slowdown structural:

- project-list reads perform live filesystem and Git inspection for every active project;
- project pages add a second inspection for the current project;
- inspection uses synchronous process and filesystem APIs on the local server event loop;
- generic change events invalidate more state than the originating change requires;
- semantic-analysis cache identity includes inventory metadata broader than the semantic input;
- presentation waits for broad refreshes during interactions that only changed saved metadata.

This supports introducing an explicit observation subsystem rather than treating the issue as isolated micro-optimizations.

## Architecture requirements for the improvement

The next implementation should preserve these requirements so the after-measurement can test architecture, not only faster hardware or warmer caches.

1. **Read models must be cheap.** Project list and profile reads should return persisted/currently known application state without synchronously inspecting project folders.
2. **Observation must be explicit.** A cheap probe should determine whether a deeper inspection is needed.
3. **Deep inspection must not block the request event loop.** Git and filesystem work should move to asynchronous adapters or an isolated execution path.
4. **Observation results must be reusable.** The current project page should consume the latest observation instead of immediately rescanning the same folder after a list read.
5. **Semantic identity must match semantic input.** An unrelated mtime change must not trigger working-tree semantic analysis when the diff and relevant file contents are unchanged.
6. **Invalidation must carry meaning.** Project profile, source scope, observation and analysis changes should not all collapse into the same broad `changed(workId)` behavior.
7. **Presentation-only settings must not trigger repository observation.** Language/localization should reuse existing semantic results where the underlying project state is unchanged.

## Before/after acceptance measurements

After the architecture changes, rerun equivalent scenarios on the same machine and record both absolute values and call counts.

| Measurement                                    | Current baseline                      | Desired architectural result                                                                   |
| ---------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Projects.list()` inspection calls             | 1 per active project                  | **0**                                                                                          |
| 5-project `Projects.list()` median             | 497.38 ms                             | Dominated by persisted read/presentation, not project filesystem size                          |
| Project page list + workspace inspection calls | `N + 1`                               | No duplicate deep inspection; reuse current observation                                        |
| Event-loop delay during deep inspection        | ~148–198 ms in measured cases         | Deep observation must not synchronously block the HTTP/SSE event loop                          |
| Identical workspace semantic analysis calls    | Cached after first call               | Remain cached                                                                                  |
| Unrelated mtime-only change                    | Causes another semantic-analysis call | **No semantic reanalysis** when semantic input is unchanged                                    |
| One settings save change events                | 2                                     | **1 relevant event**, or typed events with no observation invalidation for profile-only change |
| Profile-only settings save                     | Broad refresh/inspection path         | No Git/filesystem observation required                                                         |

The first performance target should be architectural rather than an arbitrary millisecond threshold: reading saved project state must not scale with project filesystem size or active-project count. Once that condition is true, a tighter local latency budget can be set from the new measurements.

## Measurements intentionally deferred

The baseline does not yet claim:

- end-to-end Electrobun click-to-settled timing from a packaged stable build;
- real Codex working-tree analysis latency or queue time;
- power, CPU or memory cost over a long-running session;
- filesystem watcher behavior, because no watcher architecture has been selected;
- cross-machine results;
- production Node 24 versus Node 26 performance equivalence.

Those measurements become useful after the synchronous read-path bottleneck is removed. Measuring live model latency first would mix an external variable into a local architectural problem that is already independently demonstrated by the results above.
