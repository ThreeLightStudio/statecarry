import { z } from 'zod';

const position = z.object({ turnId: z.string().min(1), itemId: z.string().min(1) }).strict();
export const recordRangeSchema = z.object({ start: position, end: position.optional() }).strict();
export type RecordRange = z.infer<typeof recordRangeSchema>;
export type GoalCandidate = {
  id: string; title: string; evidenceId: string; quote: string; threadId: string;
  range: RecordRange; status: 'proposed' | 'confirmed' | 'dismissed'; workId?: string;
};
export type GoalIntent = { text: string; evidenceId?: string; origin?: 'record' | 'user-input'; confirmedAt: string };
export type GoalRelation = { threadId: string; kind: 'followup' | 'parallel' | 'recheck' | 'decision-change' | 'unclear'; evidenceIds: string[]; rationale: string };
