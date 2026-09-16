import type {
  Command,
  ProjectCreateInput,
  ResumeCandidate,
  SourceRevision,
} from '@statecarry/contracts';
import { harness, source } from './helpers';

export function registerProject(
  h: ReturnType<typeof harness>,
  input: Partial<ProjectCreateInput> = {},
) {
  const command: Command = {
    requestId: h.core.ids.next(),
    expectedRevision: 0,
    payload: {
      title: 'Export project',
      cwd: '/tmp/example',
      purpose: 'Make exports easy to resume.',
      threadIds: [],
      discover: false,
      ...input,
    },
  };
  return { command, receipt: h.core.projects.create(command) };
}

export const projectCandidate = (record: SourceRevision = source()): ResumeCandidate => ({
  key: 'export-check',
  goal: 'Finish export validation',
  currentState: 'The export is implemented and its final check is still needed.',
  status: 'active',
  reason: 'The final check will establish whether the export is usable.',
  nextAction: 'Run the export check.',
  actionSource: 'recorded',
  doneWhen: 'The export check passes and its result is recorded.',
  threadId: record.threadId,
  prerequisites: [],
  evidence: [{ revisionId: record.id, quote: record.text }],
});

export function deletionCommand(h: ReturnType<typeof harness>, id: string): Command {
  const preview = h.core.projects.deletionPreview(id);
  return {
    requestId: h.core.ids.next(),
    expectedRevision: preview.revision,
    payload: { token: preview.token },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
