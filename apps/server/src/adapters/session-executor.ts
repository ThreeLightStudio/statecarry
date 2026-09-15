import { DomainError, type SessionCapability } from '@statecarry/contracts';
import type { SessionCreateInput, SessionCreateResult, SessionExecutor, SessionSendInput, SessionSendResult } from '@statecarry/core';

/**
 * Codex app-server can start isolated analysis threads, but this product has
 * no verified contract for creating a user session or submitting a message.
 * Keep the adapter explicit so an unavailable integration is never reported as
 * a successful continuation.
 */
export class UnsupportedSessionExecutor implements SessionExecutor {
  capability(): SessionCapability { return { create: 'unsupported', send: 'unsupported', verifiedAt: null, detail: 'Automatic continuation is unavailable here. Copy the handoff instructions or open the recorded conversation manually.' }; }
  async create(_input: SessionCreateInput): Promise<SessionCreateResult> { throw new DomainError('CAPABILITY_UNSUPPORTED', 'Creating a new Codex session is not supported'); }
  async send(_input: SessionSendInput): Promise<SessionSendResult> { throw new DomainError('CAPABILITY_UNSUPPORTED', 'Sending a continuation is not supported'); }
}
