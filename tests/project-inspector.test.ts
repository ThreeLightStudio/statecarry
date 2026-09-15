import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitProjectInspector } from '../apps/server/src/adapters/project-inspector';

describe('related project inspection', () => {
  it('selects a connected file beyond the first directory sample and reads its implementation excerpt', () => {
    const root = mkdtempSync(join(tmpdir(), 'statecarry-inspector-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      for (let i = 0; i < 130; i++) writeFileSync(join(root, 'src', `file-${String(i).padStart(3, '0')}.ts`), `export const file${i} = ${i};\n`);
      const target = `${'// context\n'.repeat(180)}\nexport function importantFunction() { return 'related'; }\n`;
      writeFileSync(join(root, 'src', 'target.ts'), target);

      const snapshot = new GitProjectInspector().inspect(root, { paths: ['src/target.ts'], symbols: ['importantFunction'], terms: [] });
      const file = snapshot.files?.find(item => item.path === 'src/target.ts');
      expect(file).toMatchObject({ selection: 'related', status: 'checked' });
      expect(file?.preview).toContain('importantFunction');
      expect(snapshot.inspection).toMatchObject({ strategy: 'related', relatedPaths: ['src/target.ts'] });
      expect(snapshot.inspection?.omittedCount).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records an inventory fingerprint independently of selected file contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'statecarry-inventory-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'main.ts'), 'export const main = true;\n');
      for (let i = 0; i < 130; i++) writeFileSync(join(root, 'src', `sample-${String(i).padStart(3, '0')}.ts`), `export const sample${i} = ${i};\n`);
      writeFileSync(join(root, 'src', 'zzz.ts'), 'export const zzz = true;\n');
      const inspector = new GitProjectInspector();
      const first = inspector.inspect(root, { paths: ['src/main.ts'], symbols: [], terms: [] });
      writeFileSync(join(root, 'src', 'zzz.ts'), 'export const zzz = false;\n');
      const second = inspector.inspect(root, { paths: ['src/main.ts'], symbols: [], terms: [] });
      expect(second.inventoryFingerprint).not.toBe(first.inventoryFingerprint);
      expect(second.fileFingerprint).toBe(first.fileFingerprint);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
