import { createHash, randomUUID } from 'node:crypto';
import type { Identity } from '@statecarry/core';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const identity: Identity = {
  next: randomUUID,
  hash: (value) =>
    createHash('sha256')
      .update(JSON.stringify(canonical(value)))
      .digest('hex'),
};
