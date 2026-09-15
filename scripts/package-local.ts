import { access, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

// An explicit allowlist prevents developer data, source records and old observations from shipping.
try {
  await access('LICENSE');
} catch {
  throw new Error('Choose and add LICENSE before creating a distributable build.');
}
await mkdir('.cache/releases', { recursive: true });
const directory = await mkdtemp(resolve('.cache/releases/statecarry-v0-'));
await cp('dist', join(directory, 'dist'), {
  recursive: true,
  filter: (source) => !source.endsWith('.map'),
});
for (const name of ['README.md', 'LICENSE', 'docs'])
  await cp(name, join(directory, name), { recursive: true });
try {
  await access('NOTICE');
  await cp('NOTICE', join(directory, 'NOTICE'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const files: { path: string; sha256: string; bytes: number }[] = [];
async function inspect(path = '') {
  for (const entry of await readdir(join(directory, path), { withFileTypes: true })) {
    const relative = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected bundle symlink: ${relative}`);
    if (entry.isDirectory()) {
      await inspect(relative);
      continue;
    }
    const data = await readFile(join(directory, relative));
    const text = data.toString('utf8');
    const personalHome =
      /(?:\/Users\/|\/home\/)[^/\s"']+\//.test(text) || /[A-Za-z]:\\Users\\/.test(text);
    if (
      /sqlite|navigation-verification|observations\.jsonl|analysis-metrics/.test(relative) ||
      personalHome
    )
      throw new Error('Private or developer-specific bundle content: ' + relative);
    files.push({
      path: relative,
      sha256: createHash('sha256').update(data).digest('hex'),
      bytes: data.length,
    });
  }
}
await inspect();
await writeFile(
  join(directory, 'manifest.json'),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      kind: 'local development preview; user workflow validation is separate',
      files,
    },
    null,
    2,
  ),
);
console.log(directory);
