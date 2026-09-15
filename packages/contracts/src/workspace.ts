import { z } from 'zod';

/** A bounded read-only observation of a source file in the connected project. */
export const workspaceFileObservationSchema = z.object({
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
}).strict();
export type WorkspaceFileObservation = z.infer<typeof workspaceFileObservationSchema>;

/** Bounded clues from connected records used to choose project files for inspection. */
export const workspaceInspectionHintsSchema = z.object({
  paths: z.array(z.string().min(1).max(2000)).max(120),
  symbols: z.array(z.string().min(1).max(160)).max(120),
  terms: z.array(z.string().min(1).max(120)).max(120),
}).strict();
export type WorkspaceInspectionHints = z.infer<typeof workspaceInspectionHintsSchema>;

/** Records what was selected, omitted, and bounded during project inspection. */
export const workspaceInspectionSchema = z.object({
  strategy: z.enum(['related', 'sampled']),
  hints: workspaceInspectionHintsSchema,
  selectedPaths: z.array(z.string().min(1).max(2000)).max(120),
  relatedPaths: z.array(z.string().min(1).max(2000)).max(120),
  omittedPaths: z.array(z.string().min(1).max(2000)).max(120),
  omittedCount: z.number().int().nonnegative(),
  unreadablePaths: z.array(z.string().min(1).max(2000)).max(120),
  limits: z.object({
    maxFiles: z.number().int().positive(),
    maxFileBytes: z.number().int().positive(),
    maxPreview: z.number().int().positive(),
  }).strict(),
}).strict();
export type WorkspaceInspection = z.infer<typeof workspaceInspectionSchema>;

/**
 * A point-in-time observation of a project workspace used while preparing a
 * return brief. Nullable fields mean the provider could not establish a value;
 * callers must never infer an older observation when a value is unknown.
 *
 * File observations are optional for backwards compatibility with stored
 * briefs created before project files were sampled.
 */
export const workspaceSnapshotSchema = z.object({
  cwd: z.string().min(1).max(2000),
  root: z.string().max(2000).nullable().optional(),
  branch: z.string().max(500).nullable(),
  commit: z.string().max(200).nullable(),
  dirty: z.boolean().nullable(),
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
  fileObservations: z.array(workspaceFileObservationSchema).max(120).optional(),
  inspection: workspaceInspectionSchema.optional(),
}).strict();
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
