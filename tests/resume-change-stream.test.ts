// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { HttpAnalysisGateway } from '../apps/web/src/adapters/analysis-gateway';

class TestEventSource extends EventTarget {
  static current: TestEventSource;
  close = vi.fn();
  constructor(readonly url: string) {
    super();
    TestEventSource.current = this;
  }
}
afterEach(() => vi.unstubAllGlobals());

it('reports a connection once and preserves project identity for data-change notices', () => {
  vi.stubGlobal('EventSource', TestEventSource);
  const changed = vi.fn();
  const connection = vi.fn();
  const unsubscribe = new HttpAnalysisGateway().subscribe(changed, connection);
  const source = TestEventSource.current;
  source.dispatchEvent(new Event('connected'));
  expect(connection).toHaveBeenCalledExactlyOnceWith('connected');
  expect(changed).not.toHaveBeenCalled();
  source.dispatchEvent(
    new MessageEvent('change', { data: JSON.stringify({ projectId: 'project-a' }) }),
  );
  expect(changed).toHaveBeenLastCalledWith({ projectId: 'project-a' });
  source.dispatchEvent(new MessageEvent('change', { data: JSON.stringify({ projectId: null }) }));
  expect(changed).toHaveBeenLastCalledWith({ projectId: null });
  source.dispatchEvent(new MessageEvent('change', { data: 'invalid' }));
  expect(changed).toHaveBeenLastCalledWith();
  source.dispatchEvent(new Event('error'));
  source.dispatchEvent(new Event('connected'));
  expect(changed).toHaveBeenCalledTimes(3);
  expect(connection.mock.calls).toEqual([['connected'], ['disconnected'], ['connected']]);
  source.dispatchEvent(
    new MessageEvent('collection-settled', { data: JSON.stringify({ projectId: 'project-a' }) }),
  );
  expect(changed).toHaveBeenLastCalledWith({ projectId: 'project-a', kind: 'collection-settled' });
  source.dispatchEvent(new MessageEvent('collection-settled', { data: 'invalid' }));
  expect(changed).toHaveBeenCalledTimes(4);
  unsubscribe();
  source.dispatchEvent(new MessageEvent('change', { data: '{}' }));
  source.dispatchEvent(new MessageEvent('collection-settled', { data: '{}' }));
  expect(changed).toHaveBeenCalledTimes(4);
  expect(source.close).toHaveBeenCalledOnce();
});

it('retains one connection notification for consumers without a connection callback', () => {
  vi.stubGlobal('EventSource', TestEventSource);
  const changed = vi.fn();
  const unsubscribe = new HttpAnalysisGateway().subscribe(changed);
  TestEventSource.current.dispatchEvent(new Event('connected'));
  expect(changed).toHaveBeenCalledTimes(1);
  unsubscribe();
});
