import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
const root = process.cwd(), errors: string[] = [];
function scan(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name);
    if (entry.isDirectory()) { if (!['node_modules', 'dist'].includes(entry.name)) scan(file); continue; }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const rel = relative(root, file), text = readFileSync(file, 'utf8'), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const ui = rel.startsWith('apps/web/src/ui/'), presentation = rel.startsWith('packages/presentation/'), core = rel.startsWith('packages/core/'), adapter = rel.startsWith('apps/web/src/adapters/');
    const inspect = (node: ts.Node) => {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') ? node.arguments[0] : undefined;
      if (specifier && ts.isStringLiteral(specifier)) {
        const target = specifier.text;
        if (ui && /core|contracts|server|adapter/.test(target) || presentation && /react|core|server|node:|adapter/.test(target) || core && /react|presentation|node:|adapter|server/.test(target) || adapter && /@statecarry\/core/.test(target)) errors.push(`${rel}: forbidden import ${target}`);
      }
      if ((presentation || core || ui) && ts.isIdentifier(node) && ['fetch', 'XMLHttpRequest', 'EventSource'].includes(node.text)) errors.push(`${rel}: transport outside adapter`);
      if ((core || presentation) && ts.isIdentifier(node) && ['window', 'document', 'localStorage'].includes(node.text)) errors.push(`${rel}: DOM outside UI/browser adapter`);
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
}
for (const folder of ['packages', 'apps']) scan(resolve(root, folder));
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; } else console.log('UI / Presentation / Core dependency boundaries passed');
