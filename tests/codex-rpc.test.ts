import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { CodexRpc } from '../apps/server/src/adapters/rpc';

const { spawn, resolveExecutable } = vi.hoisted(() => ({
  spawn: vi.fn(),
  resolveExecutable: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('../apps/server/src/adapters/executable-resolver', () => ({
  resolveExecutable,
  executableEnvironment: () => ({ PATH: '/tools:/usr/bin:/bin' }),
}));
afterEach(() => vi.resetAllMocks());

function transport() {
  const packets: any[] = [];
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr: new PassThrough(),
    stdin: new Writable({
      write(chunk, _encoding, callback) {
        const packet = JSON.parse(String(chunk));
        packets.push(packet);
        if (packet.id !== undefined)
          queueMicrotask(() =>
            stdout.write(JSON.stringify({ id: packet.id, result: { ok: true } }) + '\n'),
          );
        callback();
      },
    }),
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => child.emit('exit', 0)),
  });
  spawn.mockReturnValue(child);
  resolveExecutable.mockImplementation((name) => (name === 'codex' ? '/tools/codex' : null));
  return { child, packets };
}

it.each([false, true])(
  'connects and exchanges RPC frames without RTK (keepAwake=%s)',
  async (keepAwake) => {
    const { packets } = transport();
    const rpc = new CodexRpc({ model: 'synthetic-model' }, '/project', 1000, undefined, keepAwake);
    try {
      await expect(rpc.request('model/list')).resolves.toEqual({ ok: true });
      const preventIdleSleep = keepAwake && process.platform === 'darwin';
      expect(spawn).toHaveBeenCalledWith(
        preventIdleSleep ? '/usr/bin/caffeinate' : '/tools/codex',
        [
          ...(preventIdleSleep ? ['-i', '/tools/codex'] : []),
          'app-server',
          '--listen',
          'stdio://',
          '-c',
          'model="synthetic-model"',
        ],
        expect.objectContaining({ cwd: '/project', stdio: 'pipe' }),
      );
      expect(packets.map((packet) => packet.method)).toEqual([
        'initialize',
        'initialized',
        'model/list',
      ]);
    } finally {
      await rpc.close();
    }
  },
);

it('reports an unavailable Codex CLI before starting a transport', async () => {
  resolveExecutable.mockReturnValue(null);
  await expect(new CodexRpc().connect()).rejects.toThrow('Codex CLI was not found');
  expect(spawn).not.toHaveBeenCalled();
});
