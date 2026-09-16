import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import {
  commandSchema,
  DomainError,
  observationSchema,
  type Observation,
} from '@statecarry/contracts';
import type { StateCarry } from '@statecarry/core';
import { canonicalProjectCommand } from './adapters/project-folder';

export class ChangeEvents extends EventEmitter {
  constructor(private record?: (event: Observation) => Promise<boolean>) {
    super();
  }
  async observe(event: Observation) {
    try {
      return this.record ? await this.record(event) : false;
    } catch {
      return false;
    }
  }
  changed(workId: string | null) {
    this.emit('change', { workId });
  }
  collectionSettled(workId: string) {
    this.emit('collection-settled', { workId });
  }
}
const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
};
async function body(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json')
    throw new DomainError('VALIDATION', 'JSON content type required', 415);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const b of req) {
    size += b.length;
    if (size > 256 * 1024) throw new DomainError('VALIDATION', 'Request body too large', 413);
    chunks.push(b);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError('VALIDATION', 'Malformed JSON');
  }
}
export function createHttpServer(
  core: StateCarry,
  events: ChangeEvents,
  webDir: string,
  port = 4310,
) {
  const origins = new Set([`http://127.0.0.1:${port}`, 'http://127.0.0.1:4311']);
  return createServer(async (req, res) => {
    try {
      if (!req.headers.host || ![`127.0.0.1:${port}`, '127.0.0.1:4311'].includes(req.headers.host))
        throw new DomainError('VALIDATION', 'Unexpected Host', 403);
      const origin = req.headers.origin;
      if (origin && !origins.has(origin))
        throw new DomainError('VALIDATION', 'Unexpected Origin', 403);
      if (
        !origin &&
        !['GET', 'HEAD'].includes(req.method ?? '') &&
        req.headers['sec-fetch-site'] === 'cross-site'
      )
        throw new DomainError('VALIDATION', 'Cross-site request rejected', 403);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`),
        path = url.pathname;
      if (path === '/api/v1/events') {
        if (req.method !== 'GET') throw new DomainError('VALIDATION', 'GET required', 405);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        res.write('event: connected\ndata: {}\n\n');
        const change = (value: unknown) =>
          res.write(`event: change\ndata: ${JSON.stringify(value)}\n\n`);
        const settled = (value: unknown) =>
          res.write(`event: collection-settled\ndata: ${JSON.stringify(value)}\n\n`);
        events.on('change', change);
        events.on('collection-settled', settled);
        const timer = setInterval(() => res.write(': keepalive\n\n'), 20000);
        req.on('close', () => {
          events.off('change', change);
          events.off('collection-settled', settled);
          clearInterval(timer);
        });
        return;
      }
      if (path.startsWith('/api/v1/')) {
        const parts = path.slice('/api/v1/'.length).split('/').map(decodeURIComponent);
        if (parts[0] === 'project-workspace') {
          if (req.method === 'GET' && parts.length === 1)
            return json(res, 200, core.projects.list());
          if (req.method === 'GET' && parts.length === 3 && parts[2] === 'deletion')
            return json(res, 200, core.projects.deletionPreview(parts[1]));
          if (req.method === 'POST') {
            const command = commandSchema.parse(await body(req));
            if (parts.length === 1)
              return json(res, 200, core.projects.create(canonicalProjectCommand(command)));
            if (parts.length === 3) {
              const [, workId, action] = parts;
              if (action === 'settings')
                return json(res, 200, core.projects.settings(workId, command));
              if (action === 'sources')
                return json(res, 200, core.projects.sources(workId, command));
              if (action === 'disconnect')
                return json(res, 200, core.projects.disconnect(workId, command));
              if (action === 'restore')
                return json(res, 200, core.projects.restore(workId, command));
              if (action === 'deletion')
                return json(res, 200, core.projects.delete(workId, command));
            }
          }
          throw new DomainError('NOT_FOUND', 'Project workspace route not found.', 404);
        }
        if (parts[0] === 'resume') {
          if (req.method === 'GET' && parts.length === 1)
            return json(res, 200, core.resumes.list());
          if (req.method === 'POST' && parts.length === 3) {
            const input = await body(req);
            if (parts[2] === 'refresh') {
              core.work(parts[1]);
              void core.resumes.refresh(parts[1]);
              return json(res, 202, { accepted: true });
            }
            if (parts[2] === 'goal') return json(res, 200, core.resumes.setGoal(parts[1], input));
            if (parts[2] === 'correct')
              return json(res, 200, core.resumes.correct(parts[1], input));
            if (parts[2] === 'coordination')
              return json(res, 200, core.resumes.setCoordination(parts[1], input));
          }
          throw new DomainError('NOT_FOUND', 'Resume route not found', 404);
        }
        if (
          req.method === 'GET' &&
          parts[0] === 'work-contexts' &&
          parts[2] === 'evidence' &&
          parts.length === 4
        )
          return json(res, 200, core.evidence(parts[3], parts[1]));
        if (parts[0] === 'work-contexts' && parts[2] === 'explanations') {
          const [, workId, , id, action, revisionId] = parts;
          if (req.method === 'POST' && id === 'prepare' && parts.length === 4)
            return json(res, 202, core.explanations.prepare(workId, await body(req)));
          if (req.method === 'POST' && action === 'retry' && parts.length === 5)
            return json(res, 202, core.explanations.retry(workId, id, await body(req)));
          if (req.method === 'GET' && action === 'evidence' && parts.length === 6)
            return json(res, 200, core.explanations.evidence(workId, id, revisionId));
          if (req.method === 'GET' && id && parts.length === 4)
            return json(res, 200, core.explanations.get(workId, id));
          throw new DomainError('NOT_FOUND', 'Explanation route not found', 404);
        }
        if (parts[0] === 'work-contexts' && parts[2] === 'questions') {
          const [, workId, , sessionId, action, turnId, detail, revisionId] = parts;
          if (req.method === 'GET' && sessionId && parts.length === 4)
            return json(res, 200, core.questions.get(workId, sessionId));
          if (
            req.method === 'GET' &&
            action === 'turns' &&
            detail === 'evidence' &&
            revisionId &&
            parts.length === 8
          )
            return json(res, 200, core.questions.evidence(workId, sessionId, turnId, revisionId));
          if (req.method === 'POST') {
            const input = await body(req);
            if (parts.length === 3) return json(res, 200, core.questions.create(workId, input));
            if (action === 'turns' && parts.length === 5)
              return json(res, 202, core.questions.submit(workId, sessionId, input));
            if (action === 'turns' && detail === 'retry' && parts.length === 7)
              return json(res, 202, core.questions.retry(workId, sessionId, turnId, input));
            if (action === 'end' && parts.length === 5) {
              core.questions.end(workId, sessionId);
              return json(res, 200, { ended: true });
            }
          }
          throw new DomainError('NOT_FOUND', 'Question route not found', 404);
        }
        if (req.method === 'GET') {
          if (parts[0] === 'capabilities' && parts.length === 1)
            return json(res, 200, core.capabilities());
          if (parts[0] === 'connections' && parts[1] === 'removed' && parts.length === 2)
            return json(res, 200, core.listRemovedConnections());
          if (parts[0] === 'connections' && parts.length === 1)
            return json(res, 200, core.listConnections());
          if (parts[0] === 'turns' && parts.length === 2 && core.reader.listTurns)
            return json(res, 200, await core.reader.listTurns(parts[1]));
          if (parts[0] === 'discover' && parts.length === 1) {
            const cwd = url.searchParams.get('cwd');
            if (!cwd || !cwd.startsWith('/'))
              throw new DomainError('VALIDATION', 'Absolute project folder required');
            return json(res, 200, await core.reader.discover(cwd));
          }
          if (parts[0] === 'projects' && parts.length === 1)
            return json(res, 200, core.listProjects());
          if (parts[0] === 'work-contexts' && parts.length === 2)
            return json(res, 200, core.snapshot(parts[1]));
          if (parts[0] === 'evidence' && parts.length === 2)
            return json(res, 200, core.evidence(parts[1]));
          if (parts[0] === 'jobs' && parts.length === 2 && parts[1]) {
            const job = core.repo.get('job', parts[1]);
            if (job) return json(res, 200, job);
          }
          if (parts[0] === 'commands' && parts.length === 2 && parts[1]) {
            const receipt = core.repo.get('receipt', parts[1]);
            if (receipt)
              return json(res, 200, {
                ...receipt,
                handoff: core.repo.get('handoff', receipt.resultId),
                continuation: core.repo.get('continuation', receipt.resultId),
              });
          }
          if (
            parts[0] === 'work-contexts' &&
            ['continuation', 'continuations'].includes(parts[2]) &&
            parts.length === 4 &&
            parts[3]
          )
            return json(res, 200, core.continuations.get(parts[1], parts[3]));
        }
        if (req.method === 'POST') {
          if (parts[0] === 'observations' && parts.length === 1) {
            const event = observationSchema.parse(await body(req));
            if (event.workId) core.work(event.workId);
            if (
              event.summaryId &&
              core.repo.get('summary', event.summaryId)?.workId !== event.workId
            )
              throw new DomainError('VALIDATION', 'Observation summary belongs to another work');
            return json(res, 202, { recorded: await events.observe(event) });
          }
          const command = commandSchema.parse(await body(req));
          if (parts[0] === 'connections' && parts.length === 3 && parts[2] === 'remove')
            return json(res, 200, core.removeConnection(parts[1], command));
          if (parts[0] === 'connections' && parts.length === 3 && parts[2] === 'restore')
            return json(res, 200, core.restoreConnection(parts[1], command));
          if (parts[0] === 'connections' && parts.length === 2)
            return json(
              res,
              200,
              core.updateConnection(parts[1], canonicalProjectCommand(command)),
            );
          if (parts[0] === 'connections' && parts.length === 1) {
            const receipt = core.connect(canonicalProjectCommand(command));
            json(res, 200, receipt);
            events.changed(receipt.workId);
            return;
          }
          if (parts[0] === 'work-contexts' && parts.length === 3) {
            const [, workId, action] = parts;
            if (action === 'goal-intent') return json(res, 200, core.describeGoal(workId, command));
            if (action === 'goals') return json(res, 200, core.chooseGoal(workId, command));
            if (action === 'handoff')
              return json(
                res,
                200,
                core.prepareHandoff(workId, command.expectedRevision, command.payload),
              );
            if (['continuation', 'continuations'].includes(action))
              return json(res, 200, core.continuations.prepare(workId, command));
            if (['corrections', 'drafts', 'visits'].includes(action))
              return json(
                res,
                200,
                core.mutate(workId, action as 'corrections' | 'drafts' | 'visits', command),
              );
          }
          if (
            parts[0] === 'work-contexts' &&
            ['continuation', 'continuations'].includes(parts[2]) &&
            parts.length === 5 &&
            ['send', 'open'].includes(parts[4])
          ) {
            const workId = parts[1],
              continuationId = parts[3],
              routed = { ...command, payload: { continuationId } };
            return json(
              res,
              200,
              parts[4] === 'send'
                ? await core.continuations.send(workId, routed)
                : await core.continuations.open(workId, routed),
            );
          }
          if (parts[0] === 'context-links' && parts.length === 2) {
            const link = core.repo.get('link', parts[1]);
            if (link) return json(res, 200, core.mutate(link.workId, 'link', command, link.id));
          }
          if (parts[0] === 'jobs' && parts.length === 3 && parts[2] === 'retry') {
            const job = core.repo.get('job', parts[1]);
            if (job) return json(res, 200, core.mutate(job.workId, 'retry', command, job.id));
          }
          if (parts[0] === 'handoffs' && parts.length === 2 && parts[1] === 'open') {
            const workId = z.string().parse(command.payload.workId),
              { workId: _, ...payload } = command.payload;
            return json(res, 200, await core.openHandoff(workId, { ...command, payload }));
          }
          if (
            ['continuation', 'continuations'].includes(parts[0]) &&
            parts.length === 2 &&
            ['send', 'open'].includes(parts[1])
          ) {
            const workId = z.string().parse(command.payload.workId),
              { workId: _, ...payload } = command.payload;
            return json(
              res,
              200,
              parts[1] === 'send'
                ? await core.continuations.send(workId, { ...command, payload })
                : await core.continuations.open(workId, { ...command, payload }),
            );
          }
        }
        throw new DomainError('NOT_FOUND', 'API route or target not found', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method ?? ''))
        throw new DomainError('NOT_FOUND', 'Route not found', 404);
      const file = resolve(webDir, path === '/' ? 'index.html' : `.${path}`);
      if (relative(webDir, file).startsWith('..'))
        throw new DomainError('NOT_FOUND', 'File not found', 404);
      let contents: Buffer;
      try {
        contents = await readFile(file);
      } catch {
        throw new DomainError(
          'NOT_FOUND',
          'Build the web application before opening the production server',
          404,
        );
      }
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      };
      res.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof DomainError)
        json(res, e.status, { error: { code: e.code, message: e.message } });
      else if (e instanceof z.ZodError)
        json(res, 400, {
          error: {
            code: 'VALIDATION',
            message: 'Input does not match the contract',
            issues: e.issues.map((i) => ({ path: i.path, message: i.message })),
          },
        });
      else {
        console.error(e);
        json(res, 500, {
          error: {
            code: 'STORAGE_UNAVAILABLE',
            message: 'The request was not committed; inspect the local server error',
          },
        });
      }
    }
  });
}
