import { DomainError, type SessionCapability } from '@statecarry/contracts';
import type {
  SessionCreateInput,
  SessionCreateResult,
  SessionExecutor,
  SessionSendInput,
  SessionSendResult,
} from '@statecarry/core';
import type { SessionQuestion, SessionRun } from '@statecarry/contracts';
import { CodexRpc } from './rpc';
import { resolveExecutable } from './executable-resolver';

type Packet = { id?: string | number; method: string; params: Record<string, any> };

/** User execution has its own transport, separate from tool-free analysis. */
export class CodexSessionExecutor implements SessionExecutor {
  private rpc: CodexRpc;
  private owned = new Set<string>();
  private pending = new Map<string, { packet: Packet; question: SessionQuestion }>();
  private runs = new Map<string, SessionRun>();
  private verifiedAt: string | null = null;
  constructor(rpc = new CodexRpc()) {
    this.rpc = rpc;
    rpc.on('serverRequest', (packet: Packet) => this.receiveRequest(packet));
    rpc.on('notification', (packet: Packet) => {
      if (packet.method === 'serverRequest/resolved') {
        this.pending.delete(String(packet.params.requestId));
      }
      if (packet.method !== 'turn/completed' || !this.owned.has(packet.params.threadId)) return;
      const turn = packet.params.turn;
      this.runs.set(`${packet.params.threadId}:${turn.id}`, this.fromTurn(turn));
    });
    rpc.on('disconnect', () => {
      this.pending.clear();
      this.owned.clear();
      for (const [id, run] of this.runs)
        if (run.status === 'running' || run.status === 'waiting')
          this.runs.set(id, { ...run, status: 'unknown', questions: [] });
    });
  }
  capability(): SessionCapability {
    const available = !!resolveExecutable('codex');
    return {
      create: available ? 'supported' : 'unsupported',
      send: available ? 'supported' : 'unsupported',
      verifiedAt: this.verifiedAt,
      detail: available
        ? 'Send a reviewed request to Codex. Any required approvals remain your choice.'
        : 'Codex CLI is unavailable. You can copy your reviewed request.',
    };
  }
  async create(input: SessionCreateInput): Promise<SessionCreateResult> {
    const result = await this.rpc.request('thread/start', { cwd: input.cwd });
    const threadId = result.thread?.id;
    if (typeof threadId !== 'string')
      throw new DomainError('RESULT_UNKNOWN', 'Codex did not return a conversation ID.');
    this.owned.add(threadId);
    this.verifiedAt = new Date().toISOString();
    return { threadId };
  }
  async send(input: SessionSendInput): Promise<SessionSendResult> {
    const alreadyOwned = this.owned.has(input.threadId);
    const readOnly = input.operation === 'direction';
    if (input.operation === 'verify' && !input.cwd)
      throw new DomainError('VALIDATION', 'Choose a project folder before running checks.');
    if (!alreadyOwned) {
      this.owned.add(input.threadId);
      try {
        await this.rpc.request('thread/resume', {
          threadId: input.threadId,
          ...(input.cwd ? { cwd: input.cwd } : {}),
        });
      } catch (error) {
        this.owned.delete(input.threadId);
        throw error;
      }
    }
    const result = await this.rpc.request('turn/start', {
      threadId: input.threadId,
      input: [{ type: 'text', text: input.text }],
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(readOnly
        ? { sandboxPolicy: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never' }
        : input.operation === 'verify'
          ? {
              sandboxPolicy: {
                type: 'workspaceWrite',
                writableRoots: [input.cwd!],
                networkAccess: false,
                excludeTmpdirEnvVar: false,
                excludeSlashTmp: false,
              },
              approvalPolicy: 'on-request',
            }
          : {}),
    });
    const turnId = result.turn?.id;
    if (typeof turnId !== 'string')
      throw new DomainError('RESULT_UNKNOWN', 'Codex did not return an execution ID.');
    if (!this.runs.has(`${input.threadId}:${turnId}`))
      this.runs.set(`${input.threadId}:${turnId}`, {
        status: 'running',
        report: '',
        error: null,
        questions: [],
      });
    return { turnId };
  }
  private fromTurn(turn: any): SessionRun {
    const status =
      turn.status === 'completed'
        ? 'completed'
        : turn.status === 'failed'
          ? 'failed'
          : turn.status === 'interrupted'
            ? 'interrupted'
            : turn.status === 'inProgress'
              ? 'running'
              : 'unknown';
    const report = (Array.isArray(turn.items) ? turn.items : [])
      .filter((item: any) => item.type === 'agentMessage' && typeof item.text === 'string')
      .map((item: any) => item.text)
      .join('\n\n')
      .slice(-40000);
    const checks = (Array.isArray(turn.items) ? turn.items : [])
      .filter((item: any) => item.type === 'commandExecution')
      .slice(-20)
      .map((item: any) => ({
        command:
          typeof item.command === 'string' ? item.command.slice(0, 2000) : 'Recorded command',
        exitCode: typeof item.exitCode === 'number' ? item.exitCode : null,
        output: typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput.slice(-4000) : '',
      }));
    return {
      status,
      report,
      checks,
      error: typeof turn.error?.message === 'string' ? turn.error.message.slice(0, 2000) : null,
      questions: [],
    };
  }
  async read(threadId: string, turnId: string | null, requestId?: string): Promise<SessionRun> {
    // A missing turn ID cannot be inferred from the most recent turn: it may belong to another request.
    if (!turnId && !requestId)
      return {
        status: 'unknown',
        report: '',
        error: 'The execution ID is unknown. Check the Codex conversation before sending again.',
        questions: [],
      };
    if (!this.owned.has(threadId)) {
      this.owned.add(threadId);
      await this.rpc.request('thread/resume', { threadId });
    }
    const result = await this.rpc.request('thread/read', { threadId, includeTurns: true });
    const turns = result.thread?.turns ?? [];
    if (!turnId && requestId) {
      const matches = turns.filter((t: any) =>
        t.items?.some(
          (item: any) =>
            item.type === 'userMessage' &&
            JSON.stringify(item.content).includes(`StateCarry execution request ID: ${requestId}`),
        ),
      );
      if (matches.length === 1) turnId = matches[0].id;
    }
    const turn = turns.find((item: any) => item.id === turnId);
    const run = turn
      ? this.fromTurn(turn)
      : (this.runs.get(`${threadId}:${turnId}`) ?? {
          status: 'unknown' as const,
          report: '',
          error: null,
          questions: [],
        });
    const questions = [...this.pending.values()]
      .filter((p) => p.packet.params.threadId === threadId && p.packet.params.turnId === turnId)
      .map((p) => p.question);
    return {
      ...run,
      ...(turnId ? { turnId } : {}),
      status: questions.length ? 'waiting' : run.status,
      questions,
    };
  }
  private receiveRequest(packet: Packet) {
    const p = packet.params;
    if (packet.id === undefined) return;
    const kind =
      packet.method === 'item/commandExecution/requestApproval'
        ? 'command'
        : packet.method === 'item/fileChange/requestApproval'
          ? 'file-change'
          : packet.method === 'item/permissions/requestApproval'
            ? 'permissions'
            : packet.method === 'item/tool/requestUserInput'
              ? 'question'
              : null;
    if (!kind) {
      this.rpc.rejectRequest(packet.id, 'StateCarry does not support this request.');
      return;
    }
    if (!this.owned.has(p.threadId)) {
      this.rpc.respond(
        packet.id,
        kind === 'question'
          ? { answers: {} }
          : kind === 'permissions'
            ? { permissions: {}, scope: 'turn' }
            : { decision: 'decline' },
      );
      return;
    }
    const id = String(packet.id);
    const question: SessionQuestion = {
      id,
      kind,
      title: kind === 'question' ? 'Codex needs your input' : 'Codex needs your approval',
      detail: [
        p.reason,
        p.command,
        p.cwd,
        p.grantRoot,
        p.changes ? JSON.stringify(p.changes) : '',
        kind === 'permissions' ? JSON.stringify(p.permissions) : '',
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 8000),
      ...(kind === 'question'
        ? {
            questions: (p.questions ?? []).map((q: any) => ({
              id: String(q.id),
              question: String(q.question),
              options: (q.options ?? []).map((o: any) => String(o.label)),
            })),
          }
        : {}),
    };
    this.pending.set(id, { packet, question });
  }
  async answer(
    threadId: string,
    questionId: string,
    accept: boolean,
    answers?: Record<string, string[]>,
  ) {
    const pending = this.pending.get(questionId);
    if (!pending || pending.packet.params.threadId !== threadId)
      throw new DomainError(
        'REVISION_CONFLICT',
        'This approval is no longer waiting. Read the current execution state.',
        409,
      );
    const { packet, question } = pending;
    const result =
      question.kind === 'question'
        ? {
            answers: Object.fromEntries(
              (question.questions ?? []).map((q) => [
                q.id,
                { answers: accept ? (answers?.[q.id] ?? []) : [] },
              ]),
            ),
          }
        : question.kind === 'permissions'
          ? { permissions: accept ? packet.params.permissions : {}, scope: 'turn' }
          : { decision: accept ? 'accept' : 'decline' };
    this.rpc.respond(packet.id!, result);
    this.pending.delete(questionId);
  }
  async interrupt(threadId: string, turnId: string) {
    await this.rpc.request('turn/interrupt', { threadId, turnId });
  }
  async close() {
    await this.rpc.close();
  }
}

/** Explicit fallback for integrations that do not provide a local Codex execution connection. */
export class UnsupportedSessionExecutor implements SessionExecutor {
  capability(): SessionCapability {
    return {
      create: 'unsupported',
      send: 'unsupported',
      verifiedAt: null,
      detail:
        'Automatic continuation is unavailable here. Copy the handoff instructions or open the recorded conversation manually.',
    };
  }
  async create(_input: SessionCreateInput): Promise<SessionCreateResult> {
    throw new DomainError(
      'CAPABILITY_UNSUPPORTED',
      'Creating a new Codex session is not supported',
    );
  }
  async send(_input: SessionSendInput): Promise<SessionSendResult> {
    throw new DomainError('CAPABILITY_UNSUPPORTED', 'Sending a continuation is not supported');
  }
}
