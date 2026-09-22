import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import {
  commandSchema,
  DomainError,
  observationSchema,
  analysisLocalizeSchema,
  analysisRefreshSchema,
  workDiscussionSyncSchema,
  workItemCreateSchema,
  releasePolicyInputSchema,
  releaseCreateInputSchema,
  deliveryTargetUpdateSchema,
  releaseCheckUpdateSchema,
  releasePolicyExceptionInputSchema,
  type Observation,
} from '@statecarry/contracts';
import type { StateCarry } from '@statecarry/core';
import { canonicalProjectCommand } from './adapters/project-folder';
import type { LocalFolderPicker } from './adapters/local-folder-picker';
import type { ProjectAssetStore } from './adapters/local-project-assets';
import type { LocalUpdater } from './adapters/local-updater';
import {
  browserStateLimit,
  browserStateSchema,
  type LocalBrowserState,
} from './adapters/local-browser-state';

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
  changed(
    projectId: string | null,
    topic?: 'profile' | 'sources' | 'observation' | 'working-tree-analysis' | 'overview',
  ) {
    this.emit('change', { projectId, ...(topic ? { topic } : {}) });
  }
  collectionSettled(projectId: string) {
    this.emit('collection-settled', { projectId });
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
async function body(req: IncomingMessage, limit = 256 * 1024) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json')
    throw new DomainError('VALIDATION', 'JSON content type required', 415);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const b of req) {
    size += b.length;
    if (size > limit) throw new DomainError('VALIDATION', 'Request body too large', 413);
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
  local: {
    folderPicker?: LocalFolderPicker;
    projectAssetStore?: ProjectAssetStore;
    updater?: LocalUpdater;
    developmentOrigin?: string;
    browserState?: LocalBrowserState;
  } = {},
) {
  return createServer(async (req, res) => {
    try {
      const authority = `127.0.0.1:${port === 0 ? req.socket.localPort : port}`;
      const serverOrigin = `http://${authority}`;
      if (req.headers.host !== authority)
        throw new DomainError('VALIDATION', 'Unexpected Host', 403);
      const origin = req.headers.origin;
      if (origin && origin !== serverOrigin && origin !== local.developmentOrigin)
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
      const url = new URL(req.url ?? '/', serverOrigin),
        path = url.pathname;
      if (path === '/api/v1/local/browser-state' && local.browserState && req.method === 'POST') {
        local.browserState.write(browserStateSchema.parse(await body(req, browserStateLimit)));
        return json(res, 200, { saved: true });
      }
      if (process.env.STATECARRY_TRACE_HTTP === '1' && path.startsWith('/api/v1/'))
        console.log(`[http] ${req.method ?? 'GET'} ${path}`);
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
        if (parts[0] === 'local' && parts[1] === 'project-assets') {
          if (!local.projectAssetStore)
            throw new DomainError(
              'CAPABILITY_UNSUPPORTED',
              'Project images are unavailable in this environment.',
              501,
            );
          if (req.method === 'POST' && parts[2] === 'select' && parts.length === 3) {
            const input = z
              .object({ projectId: z.string().min(1).max(250), kind: z.enum(['icon', 'banner']) })
              .strict()
              .parse(await body(req));
            core.project(input.projectId);
            return json(res, 200, { assetRef: await local.projectAssetStore.select(input.kind) });
          }
          if (req.method === 'GET' && parts.length === 3) {
            const asset = await local.projectAssetStore.read(parts[2]);
            res.writeHead(200, {
              'Content-Type': asset.contentType,
              'Cache-Control': 'private, max-age=31536000, immutable',
              'X-Content-Type-Options': 'nosniff',
            });
            res.end(asset.contents);
            return;
          }
          throw new DomainError('NOT_FOUND', 'Project image route not found.', 404);
        }
        if (parts[0] === 'local' && parts[1] === 'folder-picker' && parts.length === 2) {
          if (req.method !== 'POST') throw new DomainError('VALIDATION', 'POST required', 405);
          z.object({})
            .strict()
            .parse(await body(req));
          if (!local.folderPicker)
            throw new DomainError(
              'CAPABILITY_UNSUPPORTED',
              'The local folder picker is unavailable.',
              501,
            );
          return json(res, 200, { path: await local.folderPicker.choose() });
        }
        if (parts[0] === 'local' && parts[1] === 'updater' && parts.length >= 2) {
          if (!local.updater)
            throw new DomainError(
              'CAPABILITY_UNSUPPORTED',
              'App updates are unavailable in this environment.',
              501,
            );
          if (req.method === 'GET' && parts.length === 2)
            return json(res, 200, await local.updater.state());
          if (req.method === 'POST' && parts.length === 3) {
            z.object({})
              .strict()
              .parse(await body(req));
            if (parts[2] === 'check') return json(res, 200, await local.updater.check());
            if (parts[2] === 'download') return json(res, 200, await local.updater.download());
            if (parts[2] === 'restart') return json(res, 202, await local.updater.restart());
          }
          throw new DomainError('NOT_FOUND', 'Updater route not found.', 404);
        }
        if (parts[0] === 'projects') {
          if (parts.length === 3 && parts[2] === 'execution') {
            if (req.method === 'GET')
              return json(
                res,
                200,
                core.executions.view(
                  parts[1],
                  z.enum(['en', 'ko']).parse(url.searchParams.get('outputLanguage') ?? 'en'),
                ),
              );
            if (req.method === 'POST') {
              const input = z
                .object({ expectedVersion: z.number().int().nonnegative(), command: z.unknown() })
                .strict()
                .parse(await body(req));
              return json(
                res,
                200,
                await core.executions.command(parts[1], input.command, input.expectedVersion),
              );
            }
          }
          if (req.method === 'GET' && parts.length === 2 && parts[1] === 'analysis')
            return json(res, 200, core.analyses.list());
          if (req.method === 'GET' && parts.length === 1)
            return json(res, 200, core.projects.list());
          if (req.method === 'GET' && parts.length === 2 && parts[1] === 'registrations')
            return json(res, 200, core.projects.registrations());
          if (req.method === 'GET' && parts.length === 3 && parts[2] === 'now')
            return json(res, 200, {
              model: core.projectModel.view(parts[1]),
              now: core.now.resolve(parts[1]),
              initialized: core.projectModel.initialized(parts[1]),
            });
          if (req.method === 'POST' && parts.length === 3 && parts[2] === 'initialize') {
            const input = z
              .object({ outputLanguage: z.enum(['en', 'ko']).default('en') })
              .strict()
              .parse(await body(req));
            if (!core.projectModel.initialized(parts[1]))
              await core.analyses.refresh(parts[1], input.outputLanguage);
            if (!core.projectModel.initialized(parts[1])) {
              const prepared = core.analyses.view(parts[1]);
              throw new DomainError(
                'PROJECT_INITIALIZATION_FAILED',
                prepared.error ?? prepared.stateDetail ?? 'Project preparation did not finish.',
                503,
              );
            }
            return json(res, 200, {
              model: core.projectModel.view(parts[1]),
              now: core.now.resolve(parts[1]),
              initialized: core.projectModel.initialized(parts[1]),
            });
          }
          if (req.method === 'GET' && parts.length === 3 && parts[2] === 'release')
            return json(res, 200, core.releases.view(parts[1]));
          if (req.method === 'GET' && parts.length === 3 && parts[2] === 'workspace') {
            const outputLanguage = z
              .enum(['en', 'ko'])
              .parse(url.searchParams.get('outputLanguage') ?? 'en');
            return json(res, 200, await core.projects.workspace(parts[1], outputLanguage));
          }
          if (req.method === 'POST' && parts.length === 3 && parts[2] === 'observe') {
            const input = z
              .object({ outputLanguage: z.enum(['en', 'ko']).default('en') })
              .strict()
              .parse(await body(req));
            await core.projects.observe(parts[1], input.outputLanguage, undefined, false);
            return json(res, 200, core.projects.latestSnapshot(parts[1], input.outputLanguage));
          }
          if (req.method === 'POST' && parts.length === 3 && parts[2] === 'analysis') {
            const input = z
              .object({ outputLanguage: z.enum(['en', 'ko']).default('en') })
              .strict()
              .parse(await body(req));
            return json(
              res,
              200,
              await core.projects.analyzeLatest(parts[1], input.outputLanguage),
            );
          }
          if (req.method === 'GET' && parts.length === 3 && parts[2] === 'deletion')
            return json(res, 200, core.projects.deletionPreview(parts[1]));
          if (
            req.method === 'POST' &&
            (parts.length === 1 ||
              (parts.length === 3 &&
                [
                  'select-proposal',
                  'select-work',
                  'create-work',
                  'pause-work',
                  'resume-work',
                  'complete-work',
                  'stop-work',
                  'continue-direction-conflict',
                  'sync-discussion',
                  'release-policy',
                  'create-release',
                  'update-delivery',
                  'update-release-check',
                  'confirm-release',
                  'release-exception',
                  'settings',
                  'sources',
                  'disconnect',
                  'restore',
                  'deletion',
                ].includes(parts[2])))
          ) {
            const command = commandSchema.parse(await body(req));
            if (parts.length === 1)
              return json(res, 200, core.projects.create(canonicalProjectCommand(command)));
            if (parts.length === 3) {
              const [, projectId, action] = parts;
              if (action === 'select-proposal') {
                if (core.project(projectId).revision !== command.expectedRevision)
                  throw new DomainError(
                    'REVISION_CONFLICT',
                    'The project changed before the selected proposal could be linked.',
                    409,
                  );
                const input = z
                  .object({ proposalKey: z.string().min(1).max(250) })
                  .strict()
                  .parse(command.payload);
                return json(
                  res,
                  200,
                  core.projectModel.selectProposal(projectId, input.proposalKey),
                );
              }
              if (action === 'select-work') {
                if (core.project(projectId).revision !== command.expectedRevision)
                  throw new DomainError(
                    'REVISION_CONFLICT',
                    'The project changed before current work could be selected.',
                    409,
                  );
                const input = z
                  .object({ workItemId: z.string().min(1).max(250) })
                  .strict()
                  .parse(command.payload);
                return json(
                  res,
                  200,
                  core.projectModel.selectCurrentWork(projectId, input.workItemId),
                );
              }
              if (action === 'create-work') {
                if (core.project(projectId).revision !== command.expectedRevision)
                  throw new DomainError(
                    'REVISION_CONFLICT',
                    'The project changed before this work could be created.',
                    409,
                  );
                const input = workItemCreateSchema.parse(command.payload);
                return json(
                  res,
                  200,
                  core.projectModel.createWork(projectId, input, command.requestId),
                );
              }
              if (
                action === 'pause-work' ||
                action === 'resume-work' ||
                action === 'complete-work' ||
                action === 'stop-work'
              ) {
                if (core.project(projectId).revision !== command.expectedRevision)
                  throw new DomainError(
                    'REVISION_CONFLICT',
                    'The project changed before this work state could be saved.',
                    409,
                  );
                const input = z
                  .object({ workItemId: z.string().min(1).max(250) })
                  .strict()
                  .parse(command.payload);
                const model =
                  action === 'pause-work'
                    ? core.projectModel.pauseWork(projectId, input.workItemId)
                    : action === 'resume-work'
                      ? core.projectModel.resumeWork(projectId, input.workItemId)
                      : action === 'complete-work'
                        ? core.projectModel.completeWork(projectId, input.workItemId)
                        : core.projectModel.stopWork(projectId, input.workItemId);
                return json(res, 200, model);
              }
              if (action === 'continue-direction-conflict') {
                if (core.project(projectId).revision !== command.expectedRevision)
                  throw new DomainError(
                    'REVISION_CONFLICT',
                    'The project changed before this direction decision could be saved.',
                    409,
                  );
                z.object({}).strict().parse(command.payload);
                return json(res, 200, core.projectModel.continueDirectionConflict(projectId));
              }
              if (action === 'sync-discussion') {
                if (core.project(projectId).revision !== command.expectedRevision)
                  throw new DomainError(
                    'REVISION_CONFLICT',
                    'The project changed before this discussion could be saved.',
                    409,
                  );
                const input = workDiscussionSyncSchema.parse(command.payload);
                return json(res, 200, core.projectModel.syncDiscussion(projectId, input));
              }
              if (
                action === 'release-policy' ||
                action === 'create-release' ||
                action === 'update-delivery' ||
                action === 'update-release-check' ||
                action === 'confirm-release' ||
                action === 'release-exception'
              ) {
                if (core.project(projectId).revision !== command.expectedRevision)
                  throw new DomainError(
                    'REVISION_CONFLICT',
                    'The project changed before this release decision could be saved.',
                    409,
                  );
                if (action === 'release-policy') {
                  const input = releasePolicyInputSchema.parse(command.payload);
                  core.releases.setPolicy(projectId, input);
                  return json(res, 200, core.releases.view(projectId));
                }
                if (action === 'create-release') {
                  const input = releaseCreateInputSchema.parse(command.payload);
                  return json(
                    res,
                    200,
                    core.releases.createRelease(projectId, input, command.requestId),
                  );
                }
                if (action === 'update-delivery') {
                  const payload = z
                    .object({ releaseId: z.string().min(1).max(250) })
                    .and(deliveryTargetUpdateSchema)
                    .parse(command.payload);
                  const { releaseId, ...input } = payload;
                  return json(res, 200, core.releases.updateTarget(projectId, releaseId, input));
                }
                if (action === 'update-release-check') {
                  const payload = z
                    .object({ releaseId: z.string().min(1).max(250) })
                    .and(releaseCheckUpdateSchema)
                    .parse(command.payload);
                  const { releaseId, ...input } = payload;
                  return json(res, 200, core.releases.updateCheck(projectId, releaseId, input));
                }
                if (action === 'confirm-release') {
                  const input = z
                    .object({ releaseId: z.string().min(1).max(250) })
                    .strict()
                    .parse(command.payload);
                  return json(res, 200, core.releases.confirmRelease(projectId, input.releaseId));
                }
                const input = releasePolicyExceptionInputSchema.parse(command.payload);
                core.releases.createException(projectId, input, command.requestId);
                return json(res, 200, core.releases.view(projectId));
              }
              if (action === 'settings')
                return json(res, 200, core.projects.settings(projectId, command));
              if (action === 'sources')
                return json(res, 200, core.projects.sources(projectId, command));
              if (action === 'disconnect')
                return json(res, 200, core.projects.disconnect(projectId, command));
              if (action === 'restore')
                return json(res, 200, core.projects.restore(projectId, command));
              if (action === 'deletion')
                return json(res, 200, core.projects.delete(projectId, command));
            }
          }
        }
        if (parts[0] === 'projects' && parts[2] === 'analysis') {
          if (req.method === 'GET' && parts.length === 3)
            return json(res, 200, core.analyses.view(parts[1]));
          if (req.method === 'POST' && parts.length === 4) {
            const input = await body(req);
            if (parts[3] === 'refresh') {
              core.project(parts[1]);
              const refresh = analysisRefreshSchema.parse(input);
              void core.analyses.refresh(parts[1], refresh.outputLanguage);
              return json(res, 202, { accepted: true });
            }
            if (parts[3] === 'localize') {
              core.project(parts[1]);
              const localize = analysisLocalizeSchema.parse(input);
              await core.analyses.localize(parts[1], localize.outputLanguage);
              return json(res, 200, { localized: true, outputLanguage: localize.outputLanguage });
            }
            if (parts[3] === 'goal') return json(res, 200, core.analyses.setGoal(parts[1], input));
            if (parts[3] === 'correct')
              return json(res, 200, core.analyses.correct(parts[1], input));
            if (parts[3] === 'discussion')
              return json(res, 200, await core.analyses.discuss(parts[1], input));
            if (parts[3] === 'coordination')
              return json(res, 200, core.analyses.setCoordination(parts[1], input));
          }
          throw new DomainError('NOT_FOUND', 'Resume route not found', 404);
        }
        if (
          req.method === 'GET' &&
          parts[0] === 'projects' &&
          parts[2] === 'evidence' &&
          parts.length === 4
        )
          return json(res, 200, core.evidence(parts[3], parts[1]));
        if (parts[0] === 'projects' && parts[2] === 'explanations') {
          const [, projectId, , id, action, revisionId] = parts;
          if (req.method === 'POST' && id === 'prepare' && parts.length === 4)
            return json(res, 202, core.explanations.prepare(projectId, await body(req)));
          if (req.method === 'POST' && action === 'retry' && parts.length === 5)
            return json(res, 202, core.explanations.retry(projectId, id, await body(req)));
          if (req.method === 'GET' && action === 'evidence' && parts.length === 6)
            return json(res, 200, core.explanations.evidence(projectId, id, revisionId));
          if (req.method === 'GET' && id && parts.length === 4)
            return json(res, 200, core.explanations.get(projectId, id));
          throw new DomainError('NOT_FOUND', 'Explanation route not found', 404);
        }
        if (parts[0] === 'projects' && parts[2] === 'questions') {
          const [, projectId, , sessionId, action, turnId, detail, revisionId] = parts;
          if (req.method === 'GET' && sessionId && parts.length === 4)
            return json(res, 200, core.questions.get(projectId, sessionId));
          if (
            req.method === 'GET' &&
            action === 'turns' &&
            detail === 'evidence' &&
            revisionId &&
            parts.length === 8
          )
            return json(
              res,
              200,
              core.questions.evidence(projectId, sessionId, turnId, revisionId),
            );
          if (req.method === 'POST') {
            const input = await body(req);
            if (parts.length === 3) return json(res, 200, core.questions.create(projectId, input));
            if (action === 'turns' && parts.length === 5)
              return json(res, 202, core.questions.submit(projectId, sessionId, input));
            if (action === 'turns' && detail === 'retry' && parts.length === 7)
              return json(res, 202, core.questions.retry(projectId, sessionId, turnId, input));
            if (action === 'end' && parts.length === 5) {
              core.questions.end(projectId, sessionId);
              return json(res, 200, { ended: true });
            }
          }
          throw new DomainError('NOT_FOUND', 'Question route not found', 404);
        }
        if (req.method === 'GET') {
          if (parts[0] === 'capabilities' && parts.length === 1)
            return json(res, 200, core.capabilities());
          if (
            parts[0] === 'projects' &&
            parts[1] === 'connections' &&
            parts[2] === 'removed' &&
            parts.length === 3
          )
            return json(res, 200, core.listRemovedConnections());
          if (parts[0] === 'projects' && parts[1] === 'connections' && parts.length === 2)
            return json(res, 200, core.listConnections());
          if (parts[0] === 'turns' && parts.length === 2 && core.reader.listTurns)
            return json(res, 200, await core.reader.listTurns(parts[1]));
          if (parts[0] === 'discover' && parts.length === 1) {
            const cwd = url.searchParams.get('cwd');
            if (!cwd || !cwd.startsWith('/'))
              throw new DomainError('VALIDATION', 'Absolute project folder required');
            return json(res, 200, await core.reader.discover(cwd));
          }
          if (parts[0] === 'projects' && parts.length === 3 && parts[2] === 'context')
            return json(res, 200, core.snapshot(parts[1]));
          if (parts[0] === 'projects' && parts[2] === 'jobs' && parts.length === 4) {
            const job = core.repo.get('job', parts[3]);
            if (job?.projectId === parts[1]) return json(res, 200, job);
          }
          if (parts[0] === 'projects' && parts[2] === 'commands' && parts.length === 4) {
            const receipt = core.repo.get('receipt', parts[3]);
            if (receipt?.projectId === parts[1])
              return json(res, 200, {
                ...receipt,
                handoff: core.repo.get('handoff', receipt.resultId),
                continuation: core.repo.get('continuation', receipt.resultId),
              });
          }
        }
        if (req.method === 'POST') {
          if (parts[0] === 'observations' && parts.length === 1) {
            const event = observationSchema.parse(await body(req));
            if (event.projectId) core.project(event.projectId);
            if (
              event.summaryId &&
              core.repo.get('summary', event.summaryId)?.projectId !== event.projectId
            )
              throw new DomainError('VALIDATION', 'Observation summary belongs to another work');
            return json(res, 202, { recorded: await events.observe(event) });
          }
          const command = commandSchema.parse(await body(req));
          if (parts[0] === 'projects' && parts.length === 3) {
            const [, projectId, action] = parts;
            if (action === 'goal-intent')
              return json(res, 200, core.describeGoal(projectId, command));
            if (action === 'handoff')
              return json(
                res,
                200,
                core.prepareHandoff(projectId, command.expectedRevision, command.payload),
              );
            if (['corrections', 'drafts', 'visits'].includes(action))
              return json(
                res,
                200,
                core.mutate(projectId, action as 'corrections' | 'drafts' | 'visits', command),
              );
          }
          if (parts[0] === 'projects' && parts[2] === 'context-links' && parts.length === 4) {
            const link = core.repo.get('link', parts[3]);
            if (link?.projectId === parts[1])
              return json(res, 200, core.mutate(parts[1], 'link', command, link.id));
          }
          if (
            parts[0] === 'projects' &&
            parts[2] === 'jobs' &&
            parts.length === 5 &&
            parts[4] === 'retry'
          ) {
            const job = core.repo.get('job', parts[3]);
            if (job?.projectId === parts[1])
              return json(res, 200, core.mutate(parts[1], 'retry', command, job.id));
          }
          if (
            parts[0] === 'projects' &&
            parts[2] === 'handoffs' &&
            parts[3] === 'open' &&
            parts.length === 4
          )
            return json(res, 200, await core.openHandoff(parts[1], command));
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
