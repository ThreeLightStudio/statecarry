import { z } from 'zod';

/** A bounded read-only observation of a source file in the connected project. */
export const workspaceFileObservationSchema = z
  .object({
    /** Path relative to the project root when one is known. */
    path: z.string().min(1).max(2000),
    /** Stable evidence identifier for this path/content observation. */
    revisionId: z.string().min(1).max(240).optional(),
    /** Content digest captured at the same point as the workspace metadata. */
    hash: z.string().min(1).max(200),
    size: z.number().int().nonnegative().nullable().optional(),
    /** Short preview used as evidence context; never the complete file. */
    preview: z.string().max(4000).nullable().optional(),
    /** Whether this file was selected from connected-record clues or the bounded fallback sample. */
    selection: z.enum(['related', 'sampled']).optional(),
    status: z.enum(['checked', 'unavailable']).optional(),
    limitation: z.string().max(1500).nullable().optional(),
  })
  .strict();
export type WorkspaceFileObservation = z.infer<typeof workspaceFileObservationSchema>;

export const workspaceGitCommitSchema = z
  .object({
    hash: z.string().min(1).max(200),
    subject: z.string().max(500),
    committedAt: z.string().datetime({ offset: true }),
    changedPaths: z.array(z.string().min(1).max(2000)).max(120),
  })
  .strict();
export type WorkspaceGitCommit = z.infer<typeof workspaceGitCommitSchema>;

export const workspaceChangedFileSchema = z
  .object({
    path: z.string().min(1).max(2000),
    status: z.enum(['added', 'modified', 'deleted', 'renamed', 'untracked']),
  })
  .strict();
export type WorkspaceChangedFile = z.infer<typeof workspaceChangedFileSchema>;

export const workingTreeWorkGroupSchema = z
  .object({
    id: z.string().min(1).max(160).optional(),
    context: z
      .array(
        z
          .object({
            kind: z.enum(['background', 'progress', 'benefit', 'unknown']),
            nature: z.enum([
              'user-request',
              'user-decision',
              'agent-report',
              'file-observation',
              'agent-interpretation',
            ]),
            text: z.string().min(1).max(700),
            sources: z.array(z.string().min(1).max(2000)).max(20),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(700),
    currentState: z.string().min(1).max(700),
    openItems: z.array(z.string().min(1).max(300)).max(5),
    suggestedNextStep: z.string().min(1).max(400),
    reason: z.string().min(1).max(500),
    doneWhen: z.string().min(1).max(500),
    files: z.array(z.string().min(1).max(2000)).min(1).max(60),
  })
  .strict();
export type WorkingTreeWorkGroup = z.infer<typeof workingTreeWorkGroupSchema>;

export const workingTreeAnalysisSchema = z
  .object({
    summary: z.string().min(1).max(900),
    groups: z.array(workingTreeWorkGroupSchema).min(1).max(5),
  })
  .strict();
export type WorkingTreeAnalysis = z.infer<typeof workingTreeAnalysisSchema>;

/** Bounded clues from connected records used to choose project files for inspection. */
export const workspaceInspectionHintsSchema = z
  .object({
    paths: z.array(z.string().min(1).max(2000)).max(120),
    symbols: z.array(z.string().min(1).max(160)).max(120),
    terms: z.array(z.string().min(1).max(120)).max(120),
  })
  .strict();
export type WorkspaceInspectionHints = z.infer<typeof workspaceInspectionHintsSchema>;

/** Discard unusable clues rather than truncate them into different paths or symbols. */
export function normalizeWorkspaceInspectionHints(
  hints?: Partial<WorkspaceInspectionHints>,
): WorkspaceInspectionHints {
  const clean = (key: keyof WorkspaceInspectionHints) =>
    [...new Set((hints?.[key] ?? []).map((value) => value.trim()))]
      .filter((value) => workspaceInspectionHintsSchema.shape[key].element.safeParse(value).success)
      .slice(0, 120);
  return { paths: clean('paths'), symbols: clean('symbols'), terms: clean('terms') };
}

/** Records what was selected, omitted, and bounded during project inspection. */
export const workspaceInspectionSchema = z
  .object({
    strategy: z.enum(['related', 'sampled']),
    hints: workspaceInspectionHintsSchema,
    selectedPaths: z.array(z.string().min(1).max(2000)).max(120),
    relatedPaths: z.array(z.string().min(1).max(2000)).max(120),
    omittedPaths: z.array(z.string().min(1).max(2000)).max(120),
    omittedCount: z.number().int().nonnegative(),
    unreadablePaths: z.array(z.string().min(1).max(2000)).max(120),
    limits: z
      .object({
        maxFiles: z.number().int().positive(),
        maxFileBytes: z.number().int().positive(),
        maxPreview: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type WorkspaceInspection = z.infer<typeof workspaceInspectionSchema>;

export type WorkspaceProbe = {
  cwd: string;
  root: string | null;
  branch: string | null;
  commit: string | null;
  statusFingerprint: string | null;
  status: 'checked' | 'unknown';
  checkedAt: string;
  limitations: string[];
};

/**
 * A point-in-time observation of a project workspace used while preparing a
 * return brief. Nullable fields mean the provider could not establish a value;
 * callers must never infer an older observation when a value is unknown.
 *
 * File observations are optional when the inspector cannot sample project files.
 */
export const workspaceSnapshotSchema = z
  .object({
    cwd: z.string().min(1).max(2000),
    root: z.string().max(2000).nullable().optional(),
    branch: z.string().max(500).nullable(),
    commit: z.string().max(200).nullable(),
    dirty: z.boolean().nullable(),
    /** Bounded recent repository history captured with the workspace check. */
    recentCommits: z.array(workspaceGitCommitSchema).max(12).optional(),
    /** Bounded paths changed in the working tree at inspection time. */
    changedPaths: z.array(z.string().min(1).max(2000)).max(120).optional(),
    /** Bounded changed-file details captured from Git porcelain output. */
    changedFiles: z.array(workspaceChangedFileSchema).max(120).optional(),
    /** Complete changed-file count, including files omitted from bounded path details. */
    changedFileCount: z.number().int().nonnegative().optional(),
    /** Tracked diff line totals against HEAD. Untracked content is not included. */
    additions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
    untrackedCount: z.number().int().nonnegative().optional(),
    /** Bounded textual diff used only for working-tree reconstruction. */
    diffPreview: z.string().max(80000).optional(),
    /** Optional semantic reconstruction produced from current repository evidence only. */
    workingTreeAnalysis: workingTreeAnalysisSchema.optional(),
    status: z.enum(['checked', 'unknown']),
    checkedAt: z.string().datetime(),
    limitations: z.array(z.string().max(1500)).max(20),
    /** Stable digest of the bounded file observation set. */
    fileFingerprint: z.string().max(256).nullable().optional(),
    /** Digest of the complete discovered file inventory (path, size, mtime). */
    inventoryFingerprint: z.string().max(256).nullable().optional(),
    /** Alias accepted for providers that call the digest simply fingerprint. */
    fingerprint: z.string().max(256).nullable().optional(),
    files: z.array(workspaceFileObservationSchema).max(120).optional(),
    /** Alias accepted by older integrations for the bounded file list. */
    inspection: workspaceInspectionSchema.optional(),
  })
  .strict();
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;

export type ProjectObservation = {
  id: string;
  projectId: string;
  checkedAt: string;
  probeKey: string;
  inspectionKey: string;
  semanticKey: string;
  snapshot: WorkspaceSnapshot;
};

export type WorkingTreeAnalysisRecord = {
  id: string;
  projectId: string;
  semanticKey: string;
  outputLanguage: 'en' | 'ko';
  result: WorkingTreeAnalysis;
  generatedAt: string;
};

/** Execution evidence supplied only after a request is compared with the project. */
export const workingTreeExecutionResultSchema = z
  .object({
    requestId: z.string().min(1).max(256),
    source: z.enum(['agent-report', 'user-report']),
    report: z.string().max(8000),
    doneWhen: z.string().max(2000),
    checks: z
      .array(
        z
          .object({
            command: z.string().max(2000),
            exitCode: z.number().int().nullable(),
            output: z.string().max(4000),
          })
          .strict(),
      )
      .max(20),
    current: z.boolean(),
    accepted: z.boolean(),
  })
  .strict();
