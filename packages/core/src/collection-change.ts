import type { Checkpoint, Connection, Link } from '@statecarry/contracts';

const unique = (values: string[]) => [...new Set(values)].sort();

/** Compare settled collection results, not the temporary `reading` write or
 * when an otherwise identical observation was repeated. Source revisions and
 * their fingerprints carry immutable content/coverage identity. */
export function collectionResult(checkpoint: Checkpoint | null, link: Link | null) {
  return {
    checkpoint: checkpoint && {
      revisionIds: checkpoint.revisionIds,
      sourceFingerprint: checkpoint.sourceFingerprint,
      generation: checkpoint.generation,
      scopeVersion: checkpoint.scopeVersion,
      status: checkpoint.status,
      limitations: unique(checkpoint.limitations),
      manifest: checkpoint.manifest,
    },
    link: link && {
      title: link.title,
      status: link.status,
      role: link.role,
      relation: link.relation,
      evidence: link.evidence,
      sourceFingerprint: link.sourceFingerprint,
    },
  };
}

/** Discovery order and pagination cursors can change just because a thread was
 * touched. Membership, coverage and scope describe the settled result. */
export function discoveryResult(discovery: Connection['discovery']) {
  return discovery
    ? {
        status: discovery.status,
        threadIds: unique(discovery.threadIds),
        limitations: unique(discovery.limitations),
        manifest: discovery.manifest && {
          filter: discovery.manifest.filter,
          complete: discovery.manifest.complete,
        },
      }
    : null;
}
