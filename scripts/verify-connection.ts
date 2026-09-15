import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { CodexReader, safeId } from '../apps/server/src/adapters/codex-reader';
import { CodexSummary } from '../apps/server/src/adapters/codex-summary';
import { verifyNavigationArrival } from '../apps/server/src/adapters/navigation-onboarding';
import { createInterface } from 'node:readline/promises';
import { release } from 'node:os';
import { dispatchCodex } from '../apps/server/src/adapters/navigator';
const dataDir = resolve(process.env.STATECARRY_DATA_DIR ?? `${homedir()}/.statecarry`);
const [mode, ...threadIds] = process.argv.slice(2);
const usage =
  'Usage: node dist/verify-connection.mjs --read <thread-id> [thread-id ...] | --preflight | --navigation <thread-id> | --verify-navigation <thread-id>';
if (mode === '--help') {
  console.log(usage);
  process.exit(0);
}
if (mode === '--verify-navigation' && threadIds.length === 1) {
  if (!process.stdin.isTTY)
    throw new Error(
      'Arrival verification requires an interactive terminal and a person inspecting Codex.',
    );
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(
      JSON.stringify(
        await verifyNavigationArrival({
          dataDir,
          threadId: threadIds[0],
          platform: process.platform,
          osBuild: release(),
          runtimeVersion: process.version,
          dispatch: dispatchCodex,
          confirm: (prompt) => input.question(prompt),
        }),
        null,
        2,
      ),
    );
  } finally {
    input.close();
  }
  process.exit(0);
}
if (
  !(
    (mode === '--read' && threadIds.length > 0) ||
    (mode === '--preflight' && threadIds.length === 0) ||
    (mode === '--navigation' && threadIds.length === 1)
  )
) {
  console.error(usage);
  process.exit(2);
}
// Validate the complete input before starting Codex or dispatching an OS URL.
for (const id of threadIds) safeId(id);
if (mode === '--preflight') {
  const provider = new CodexSummary(dataDir);
  try {
    await provider.preflight();
    console.log(JSON.stringify(provider.capability(), null, 2));
  } finally {
    await provider.close();
  }
} else if (mode === '--navigation') {
  await dispatchCodex(threadIds[0]);
  console.log(
    'OS dispatch accepted. This alone does not verify the foreground conversation. Inspect the actual Codex target before recording navigation verification.',
  );
} else {
  const reader = new CodexReader();
  try {
    for (const id of threadIds) {
      const s = await reader.read(id);
      console.log(
        JSON.stringify(
          {
            requestedId: id,
            returnedId: s.threadId,
            status: s.status,
            itemCount: s.revisions.length,
            turnCount: s.manifest.turnCount,
            limitations: s.limitations,
            fingerprint: s.manifest.fingerprint,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await reader.close();
  }
}
