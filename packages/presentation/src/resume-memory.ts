/** Browser-owned edits only. Saved server briefs and evidence must be read from Core again. */
export type ResumeGoalDraft = { text: string; version: string };
export type ResumeActionDraft = { action: string; done: string; version: string };
export type SavedResumeEdits = {
  selectedKey?: string;
  goalDraft: ResumeGoalDraft | null;
  actionDrafts: [string, ResumeActionDraft][];
  expanded: string[];
  scroll: number;
};
export interface ResumeMemory {
  read(workId: string): SavedResumeEdits | null;
  write(workId: string, state: SavedResumeEdits): void;
}
