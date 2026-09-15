// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { graphLabel, presentFlowGraph, presentReturnContext } from '@statecarry/presentation';
import { flowHarness } from './conversation-flow-fixtures';
import { sanitizeFlowSvg } from '../apps/web/src/ui/flow-renderer';
const requireWeb = createRequire(resolve('apps/web/package.json'));

it('passes the installed Mermaid parser, including hostile and multiline labels', async () => {
  const mermaid = (await import(requireWeb.resolve('mermaid'))).default;
  const { h, id } = await flowHarness();
  const graph = presentFlowGraph(presentReturnContext(h.core.snapshot(id)).current[0].flow);
  expect(await mermaid.parse(graph.source)).toBeTruthy();
  for (const label of ['따옴표 " 괄호 [] () 줄\n바꿈', '<img src=x onerror=alert(1)>', '%%{init:{securityLevel:"loose"}}%%', 'click n0 "https://example.com"', '긴 한글 '.repeat(100)]) {
    expect(await mermaid.parse(`flowchart TB\nn0["${graphLabel(label)}"]`)).toBeTruthy();
  }
});
it('removes active SVG, external resources and event handlers', () => {
  const clean = sanitizeFlowSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><a href="https://example.com"><text>link</text></a><image href="https://example.com/a"/><style>@import "https://example.com/x";</style><rect onclick="alert(1)" fill="url(https://example.com/x)"/><text>안전한 라벨</text></svg>');
  expect(clean).not.toMatch(/script|foreignObject|onload|onclick|https:|<a\b|<image/);
  expect(clean).toContain('안전한 라벨');
});
it('decodes renderer entity text without interpreting HTML and removes embedded CSS for CSP', () => {
  const clean = sanitizeFlowSvg('<svg xmlns="http://www.w3.org/2000/svg" id="fixture-svg"><style>.node{fill:red}</style><text>&amp;#60;script&amp;#62; &amp;#34;괄호&amp;#34;</text></svg>');
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  expect(doc.querySelector('text')!.textContent).toBe('<script> "괄호"');
  expect(doc.querySelector('script,style')).toBeNull();
  expect(doc.documentElement.id).toBe('fixture-svg');
});
