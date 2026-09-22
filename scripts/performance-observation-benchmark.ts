import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { StateCarry, type ProjectInspector } from '@statecarry/core';
import type { WorkspaceInspectionHints, WorkspaceSnapshot } from '@statecarry/contracts';
import { GitProjectInspector } from '../apps/server/src/adapters/project-inspector';
import { identity } from '../apps/server/src/adapters/identity';
import { harness, MemoryRepository } from '../tests/helpers';

type Counters = {
  probe: number;
  inspect: number;
  analysis: number;
  listRead: number;
  changeEvent: number;
};

const SAMPLE_COUNT = 3;
const FILE_COUNT = 1000;

function median(values: number[]) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
}

function git(cwd: string, args: string[]) {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
}

function repository(label: string) {
  const root = mkdtempSync(join(tmpdir(), 'statecarry-perf-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  for (let index = 0; index < FILE_COUNT; index++)
    writeFileSync(
      join(root, 'src', `sample-${String(index).padStart(4, '0')}.ts`),
      `export const sample${index} = ${index};\n`,
    );
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'benchmark@statecarry.local']);
  git(root, ['config', 'user.name', 'StateCarry benchmark']);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', `seed ${label}`]);
  writeFileSync(join(root, 'src', 'sample-0000.ts'), 'export const sample0 = 9999;\n');
  writeFileSync(join(root, 'scratch.ts'), 'export const scratch = true;\n');
  return root;
}

function instrumentInspector(base: ProjectInspector, counters: Counters): ProjectInspector {
  const maybeProbe = (base as ProjectInspector & { probe?: (cwd: string) => unknown }).probe;
  const maybeProbeAsync = base.probeAsync;
  const maybeInspectAsync = base.inspectAsync;
  return {
    ...(maybeProbe
      ? {
          probe(cwd: string) {
            counters.probe++;
            return maybeProbe.call(base, cwd);
          },
        }
      : {}),
    ...(maybeProbeAsync
      ? {
          async probeAsync(cwd: string) {
            counters.probe++;
            return maybeProbeAsync.call(base, cwd);
          },
        }
      : {}),
    inspect(cwd: string, hints?: WorkspaceInspectionHints): WorkspaceSnapshot {
      counters.inspect++;
      return base.inspect(cwd, hints);
    },
    ...(maybeInspectAsync
      ? {
          async inspectAsync(cwd: string, hints?: WorkspaceInspectionHints) {
            counters.inspect++;
            return maybeInspectAsync.call(base, cwd, hints);
          },
        }
      : {}),
  } as ProjectInspector;
}

function fixture() {
  const repo = new MemoryRepository();
  const h = harness(repo);
  const counters: Counters = { probe: 0, inspect: 0, analysis: 0, listRead: 0, changeEvent: 0 };
  h.summary.analyzeWorkingTree = async () => {
    counters.analysis++;
    return {
      summary: 'Synthetic working tree.',
      groups: [
        {
          title: 'Synthetic change',
          summary: 'Synthetic change for benchmark call counting.',
          currentState: 'Dirty.',
          openItems: [],
          suggestedNextStep: 'Continue.',
          reason: 'The diff is dirty.',
          doneWhen: 'The diff is clean.',
          files: ['src/sample-0000.ts'],
        },
      ],
    };
  };
  const inspector = instrumentInspector(new GitProjectInspector(), counters);
  const core = new StateCarry(
    repo,
    h.reader,
    h.summary,
    h.navigator,
    h.core.clock,
    identity,
    {
      changed() {
        counters.changeEvent++;
      },
    },
    inspector,
  );
  return { core, counters, repo, h, inspector };
}

function register(core: StateCarry, cwd: string, index: number) {
  return core.projects.create({
    requestId: identity.next(),
    expectedRevision: 0,
    payload: {
      title: `Benchmark ${index + 1}`,
      purpose: 'Measure project read-path cost.',
      cwd,
      threadIds: [],
      discover: false,
    },
  }).projectId;
}

async function listScenario(projectCount: number) {
  const roots = Array.from({ length: projectCount }, (_, index) => repository(String(index)));
  try {
    const { core, counters } = fixture();
    const ids = roots.map((root, index) => register(core, root, index));
    counters.inspect = 0;
    counters.probe = 0;
    counters.analysis = 0;
    counters.changeEvent = 0;
    core.projects.list();
    const samples: number[] = [];
    const inspectBefore = counters.inspect;
    const probeBefore = counters.probe;
    for (let index = 0; index < SAMPLE_COUNT; index++) {
      const started = performance.now();
      counters.listRead++;
      core.projects.list();
      samples.push(performance.now() - started);
    }
    const listInspect = counters.inspect - inspectBefore;
    const listProbe = counters.probe - probeBefore;

    const beforeWorkspace = counters.inspect;
    const started = performance.now();
    counters.listRead++;
    core.projects.list();
    await core.projects.workspace(ids[0], 'en');
    const listPlusWorkspaceMs = performance.now() - started;
    const listPlusWorkspaceInspect = counters.inspect - beforeWorkspace;
    return {
      projectCount,
      listMedianMs: median(samples),
      listInspectCallsPerRead: listInspect / SAMPLE_COUNT,
      listProbeCallsPerRead: listProbe / SAMPLE_COUNT,
      listPlusWorkspaceMs,
      listPlusWorkspaceInspectCalls: listPlusWorkspaceInspect,
    };
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
}

async function semanticScenario() {
  const root = repository('semantic');
  try {
    const { core, counters, repo, h, inspector } = fixture();
    const projectId = register(core, root, 0);
    counters.inspect = 0;
    counters.probe = 0;
    counters.analysis = 0;
    const firstStarted = performance.now();
    await core.projects.observe(projectId, 'en');
    const firstMs = performance.now() - firstStarted;
    const afterFirst = {
      probe: counters.probe,
      inspect: counters.inspect,
      analysis: counters.analysis,
    };
    const secondStarted = performance.now();
    await core.projects.observe(projectId, 'en');
    const unchangedReentryMs = performance.now() - secondStarted;
    const afterSecond = {
      probe: counters.probe,
      inspect: counters.inspect,
      analysis: counters.analysis,
    };
    const unrelated = join(root, 'src', 'sample-0900.ts');
    const now = new Date();
    utimesSync(unrelated, now, now);
    await core.projects.observe(projectId, 'en');
    const afterMtime = {
      probe: counters.probe,
      inspect: counters.inspect,
      analysis: counters.analysis,
    };

    const restarted = new StateCarry(
      repo,
      h.reader,
      h.summary,
      h.navigator,
      h.core.clock,
      identity,
      { changed() {} },
      inspector,
    );
    const restartReadStarted = performance.now();
    await restarted.projects.workspace(projectId, 'en');
    const restartSavedReadMs = performance.now() - restartReadStarted;
    const restartObserveStarted = performance.now();
    await restarted.projects.observe(projectId, 'en');
    const restartObserveMs = performance.now() - restartObserveStarted;
    const afterRestart = {
      probe: counters.probe,
      inspect: counters.inspect,
      analysis: counters.analysis,
    };
    return {
      firstMs,
      unchangedReentryMs,
      restartSavedReadMs,
      restartObserveMs,
      afterFirst,
      afterSecond,
      afterMtime,
      afterRestart,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function settingsScenario() {
  const root = repository('settings');
  try {
    const { core, counters } = fixture();
    const projectId = register(core, root, 0);
    counters.changeEvent = 0;
    const work = core.project(projectId);
    core.projects.settings(projectId, {
      requestId: identity.next(),
      expectedRevision: work.revision,
      payload: { title: 'Renamed benchmark', purpose: 'Measure event emission.', focused: false },
    });
    return counters.changeEvent;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function blockingScenario() {
  const inspector = new GitProjectInspector();
  let timerObserved = 0;
  const started = performance.now();
  const timer = new Promise<void>((resolve) => {
    setTimeout(() => {
      timerObserved = performance.now() - started;
      resolve();
    }, 0);
  });
  await inspector.inspectAsync(process.cwd());
  const inspectMs = performance.now() - started;
  await timer;
  return { inspectMs, timerObservedMs: timerObserved };
}

async function probeScenario() {
  const inspector = new GitProjectInspector();
  await inspector.probeAsync(process.cwd());
  const samples: number[] = [];
  for (let index = 0; index < 5; index++) {
    const started = performance.now();
    await inspector.probeAsync(process.cwd());
    samples.push(performance.now() - started);
  }
  return { medianMs: median(samples), samples };
}

const list = [];
for (const count of [1, 3, 5]) list.push(await listScenario(count));
const result = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  list,
  probe: await probeScenario(),
  blocking: await blockingScenario(),
  semantic: await semanticScenario(),
  settingsChangeEvents: settingsScenario(),
};
console.log(JSON.stringify(result, null, 2));
