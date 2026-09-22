import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const browserStateSchema = z
  .object({
    entries: z.record(z.string().startsWith('statecarry.').max(512), z.string()),
    flush: z.string().uuid().optional(),
  })
  .strict();
export const browserStateLimit = 5 * 1024 * 1024;

/** Desktop browser preferences follow the data profile, not the HTTP port. */
export class LocalBrowserState {
  private path: string;
  private pending = new Map<string, () => void>();

  constructor(dataDir: string) {
    this.path = join(dataDir, 'browser-state.json');
  }

  read(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    return browserStateSchema.parse(JSON.parse(readFileSync(this.path, 'utf8'))).entries;
  }

  write(input: z.infer<typeof browserStateSchema>) {
    const snapshot = JSON.stringify({ entries: input.entries });
    if (Buffer.byteLength(snapshot) > browserStateLimit)
      throw new Error('Browser state is too large');
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, snapshot, { mode: 0o600 });
    renameSync(temporary, this.path);
    if (input.flush) this.pending.get(input.flush)?.();
  }

  async flushBeforeQuit(request: (token: string) => void) {
    const token = randomUUID();
    await new Promise<void>((resolve) => {
      // A window may already have closed; its pagehide save is still allowed to
      // finish before the server is stopped. Never trap the user in a broken view.
      const finish = () => {
        clearTimeout(timer);
        this.pending.delete(token);
        resolve();
      };
      const timer = setTimeout(finish, 1000);
      this.pending.set(token, finish);
      try {
        request(token);
      } catch {
        finish();
      }
    });
  }
}
