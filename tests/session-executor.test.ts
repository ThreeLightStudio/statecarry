import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { CodexSessionExecutor } from '../apps/server/src/adapters/session-executor';
import type { CodexRpc } from '../apps/server/src/adapters/rpc';
import * as executableResolver from '../apps/server/src/adapters/executable-resolver';

function fixture() {
  const rpc = Object.assign(new EventEmitter(), {
    request: vi.fn(async (method: string, _params?: unknown): Promise<any> => {
      if (method === 'thread/start') return { thread: { id: 'thread' } };
      if (method === 'turn/start') return { turn: { id: 'turn' } };
      if (method === 'thread/read')
        return { thread: { turns: [{ id: 'turn', status: 'inProgress', items: [] }] } };
      return {};
    }),
    respond: vi.fn(),
    rejectRequest: vi.fn(),
    close: vi.fn(async () => {}),
  });
  return { rpc, executor: new CodexSessionExecutor(rpc as unknown as CodexRpc) };
}

it('reports the missing Codex CLI without referring to the retired RTK dependency', () => {
  const resolve = vi.spyOn(executableResolver, 'resolveExecutable').mockReturnValue(null);
  try {
    expect(new CodexSessionExecutor().capability()).toMatchObject({
      create: 'unsupported',
      send: 'unsupported',
      detail: 'Codex CLI is unavailable. You can copy your reviewed request.',
    });
  } finally {
    resolve.mockRestore();
  }
});

it('allows verification artifacts in the project without auto-approving execution', async () => {
  const { rpc, executor } = fixture();
  await executor.create({ projectId: 'work', cwd: '/project', title: 'Check' });
  await executor.send({
    projectId: 'work',
    threadId: 'thread',
    text: 'Inspect',
    cwd: '/project',
    operation: 'verify',
  });
  expect(rpc.request).toHaveBeenCalledWith(
    'turn/start',
    expect.objectContaining({
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: ['/project'],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      approvalPolicy: 'on-request',
    }),
  );
  expect(rpc.request).toHaveBeenCalledWith('thread/resume', {
    threadId: 'thread',
    cwd: '/project',
  });
  rpc.emit('serverRequest', {
    id: 14,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread', turnId: 'turn', command: 'pnpm test' },
  });
  expect(rpc.respond).not.toHaveBeenCalled();
  expect((await executor.read('thread', 'turn')).status).toBe('waiting');
  await executor.answer('thread', '14', false);
  expect(rpc.respond).toHaveBeenCalledWith(14, { decision: 'decline' });
});
it('keeps project direction requests read-only', async () => {
  const { rpc, executor } = fixture();
  await executor.send({
    projectId: 'project',
    threadId: 'thread',
    text: 'Review direction',
    cwd: '/project',
    operation: 'direction',
  });
  expect(rpc.request).toHaveBeenCalledWith(
    'turn/start',
    expect.objectContaining({
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      approvalPolicy: 'never',
    }),
  );
});

it('requires a project folder before granting verification write access', async () => {
  const { rpc, executor } = fixture();
  await expect(
    executor.send({
      projectId: 'project',
      threadId: 'thread',
      text: 'Check behavior',
      operation: 'verify',
    }),
  ).rejects.toThrow('Choose a project folder');
  expect(rpc.request).not.toHaveBeenCalled();
});

it('only returns the requested execution and reconnects to receive its events', async () => {
  const { rpc, executor } = fixture();
  rpc.request.mockImplementation(async (method) =>
    method === 'thread/read'
      ? {
          thread: {
            turns: [
              {
                id: 'old',
                status: 'completed',
                items: [{ type: 'agentMessage', text: 'unrelated' }],
              },
              {
                id: 'turn',
                status: 'completed',
                items: [{ type: 'agentMessage', text: 'actual report' }],
              },
            ],
          },
        }
      : {},
  );
  const result = await executor.read('thread', 'turn');
  expect(result).toMatchObject({ status: 'completed', report: 'actual report' });
  expect(rpc.request).toHaveBeenCalledWith('thread/resume', { threadId: 'thread' });
});
it('recovers a lost turn ID only through the exact request marker, never the latest turn', async () => {
  const { rpc, executor } = fixture();
  rpc.request.mockImplementation(async (method) =>
    method === 'thread/read'
      ? {
          thread: {
            turns: [
              {
                id: 'ours',
                status: 'completed',
                items: [
                  {
                    type: 'userMessage',
                    content: [{ type: 'text', text: 'StateCarry execution request ID: request-1' }],
                  },
                ],
              },
              { id: 'later', status: 'completed', items: [] },
            ],
          },
        }
      : {},
  );
  expect(await executor.read('thread', null, 'request-1')).toMatchObject({
    status: 'completed',
    turnId: 'ours',
  });
  expect((await executor.read('thread', null, 'missing')).status).toBe('unknown');
});
it('does not answer an approval from another conversation or after it is resolved', async () => {
  const { rpc, executor } = fixture();
  await executor.create({ projectId: 'work', cwd: '/project', title: 'Check' });
  rpc.emit('serverRequest', {
    id: 15,
    method: 'item/fileChange/requestApproval',
    params: { threadId: 'thread', turnId: 'turn' },
  });
  await expect(executor.answer('other', '15', true)).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  });
  rpc.emit('notification', { method: 'serverRequest/resolved', params: { requestId: 15 } });
  await expect(executor.answer('thread', '15', true)).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  });
  expect(rpc.respond).not.toHaveBeenCalled();
});
