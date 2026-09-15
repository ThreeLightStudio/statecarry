/** Translate relationship values into copy that can stand on its own. */
const relationLabels: Record<string, string> = {
  followup: 'Continues this work',
  parallel: 'Related work',
  recheck: 'Verification follow-up',
  'decision-change': 'Changed decision',
  unclear: 'Relationship unclear',
};

export function userRelationLabel(relation: string | null | undefined) {
  if (relation && Object.values(relationLabels).includes(relation)) return relation;
  return relation
    ? (relationLabels[relation] ?? 'Connected relationship')
    : 'Connected relationship';
}
