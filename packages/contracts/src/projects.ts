import { z } from 'zod';
import { recordRangeSchema, type RecordRange } from './goals';
import type { ResumeWork } from './resume';

export type ProjectProfile = { title: string; purpose: string; focused: boolean };

export type ProjectWorkspaceEntry = {
  workId: string;
  connectionId: string;
  title: string;
  cwd: string;
  purpose: string;
  focused: boolean;
  revision: number;
  disconnectedAt: string | null;
  acceptedKeys: string[];
  pausedKeys: string[];
  /** Transient collection state, separate from model analysis. */
  collecting?: boolean;
  resume: ResumeWork | null;
};

export type ProjectWorkspace = { projects: ProjectWorkspaceEntry[] };

export type ProjectCreateInput = {
  title: string;
  cwd: string;
  purpose: string;
  goal?: string;
  threadIds: string[];
  startTurnIds?: Record<string, string>;
  recordRanges?: Record<string, RecordRange>;
  discover: boolean;
};

export type ProjectSourcesInput = {
  threadIds: string[];
  startTurnIds: Record<string, string>;
  recordRanges?: Record<string, RecordRange>;
  discover: boolean;
};

export type ProjectDeletionPreview = {
  workId: string;
  title: string;
  token: string;
  revision: number;
  ownedRecords: number;
  exclusiveSources: number;
  sharedSources: number;
  blocked: boolean;
  explanation: string;
};

const id = z.string().min(1).max(250);
const sources = {
  threadIds: z.array(id).max(30),
  startTurnIds: z.record(id, id).default({}),
  recordRanges: z.record(id, recordRangeSchema).optional(),
  discover: z.boolean(),
};

export const projectProfileSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    purpose: z.string().trim().max(1200),
    focused: z.boolean(),
  })
  .strict();

export const projectCreateSchema = z
  .object({
    title: projectProfileSchema.shape.title,
    purpose: projectProfileSchema.shape.purpose,
    cwd: z.string().min(1).max(2000).startsWith('/'),
    goal: z.string().trim().min(1).max(1200).optional(),
    ...sources,
  })
  .strict();

export const projectSourcesSchema = z
  .object({ ...sources, startTurnIds: z.record(id, id) })
  .strict();
export const projectDeletionSchema = z.object({ token: z.string().min(1).max(250) }).strict();
