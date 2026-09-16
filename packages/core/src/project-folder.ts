/** Normalize an absolute POSIX folder spelling without reading the filesystem.
 * Case, symbolic links and non-separator characters keep their original meaning. */
export function normalizeProjectFolder(folder: string): string | null {
  if (!folder.startsWith('/') || folder.includes('\0')) return null;
  const parts: string[] = [];
  for (const part of folder.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return `/${parts.join('/')}`;
}
