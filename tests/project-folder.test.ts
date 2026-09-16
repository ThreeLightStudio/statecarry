import { describe, expect, it } from 'vitest';
import { normalizeProjectFolder } from '../packages/core/src/project-folder';

describe('absolute project folder normalization', () => {
  it.each([
    ['/', '/'],
    ['////', '/'],
    ['/./', '/'],
    ['/../../', '/'],
    ['/project/..', '/'],
    ['/project/../..', '/'],
    ['/projects/export/', '/projects/export'],
    ['//projects///export//', '/projects/export'],
    ['/projects/./export/.', '/projects/export'],
    ['/projects/draft/../export', '/projects/export'],
    ['/projects/../../export', '/export'],
    ['/projects/.../export', '/projects/.../export'],
    ['/Projects/Export', '/Projects/Export'],
    ['/projects/my export /', '/projects/my export '],
    ['/projects/%2E%2E/export', '/projects/%2E%2E/export'],
    ['/projects/한글', '/projects/한글'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeProjectFolder(input)).toBe(expected);
    expect(normalizeProjectFolder(expected)).toBe(expected);
  });

  it.each(['', '.', 'projects/export', '../export', ' /projects/export', '/projects/\0export'])(
    'rejects a non-absolute or invalid folder: %j',
    (input) => {
      expect(normalizeProjectFolder(input)).toBeNull();
    },
  );
});
