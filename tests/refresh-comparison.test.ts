import { it, expect } from 'vitest';
import { harness, source, AT } from './helpers';

it('publishes a fixed result after three updates without waiting for input to stop', async () => {
  let now = Date.parse(AT);
  const h = harness();
  // Both baseline and new implementation use the same controlled clock and schedule.
  h.core.clock.now = () => new Date(now).toISOString();
  const id = h.connect(); await h.core.collect(id);
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const generate = h.summary.generate;
  h.summary.generate = async (s, remote) => { await gate; return generate(s, remote); };
  const run = h.core.process(id);
  for (let i = 1; i <= 3; i++) { now += 1000; h.records([source(`revision ${i}`)]); await h.core.collect(id); }
  release(); await run;
  const publishedBeforeNextInput = h.repo.list('summary').length;
  now += 1000; h.records([source('still receiving input')]); await h.core.collect(id);
  console.info('fixed-range-comparison', JSON.stringify({ collectedChangesBeforeRelease: 3, publishedBeforeNextInput, jobs: h.repo.list('job').length, superseded: h.repo.list('job').filter(j => j.status === 'superseded').length, generationCalls: h.counts().generationCalls, checkCalls: h.counts().checkCalls, freshness: h.core.freshness(id).summary, processingMs: h.core.snapshot(id).summary?.processingMs ?? null }));
  expect(publishedBeforeNextInput).toBe(1); expect(h.core.freshness(id).summary).toBe('outdated');
});
