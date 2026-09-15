import mermaid from 'mermaid';
import DOMPurify from 'dompurify';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'neutral',
  htmlLabels: false,
  fontFamily: 'sans-serif',
  flowchart: { htmlLabels: false, useMaxWidth: false },
  maxTextSize: 500_000,
});
let serial = 0;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<string>>();

export function sanitizeFlowSvg(svg: string): string {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'a', 'image', 'script'],
    FORBID_ATTR: ['href', 'xlink:href'],
  });
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg')
    throw new Error('Invalid SVG');
  for (const element of doc.querySelectorAll('*')) {
    for (const attr of [...element.attributes]) {
      if (/^on/i.test(attr.name) || /url\(\s*["']?(?!#)/i.test(attr.value))
        element.removeAttribute(attr.name);
    }
  }
  for (const style of doc.querySelectorAll('style')) {
    // The application's self-only CSP forbids embedded CSS. Styling lives in flow-graph.css.
    style.remove();
  }
  // Mermaid 11's text-only renderer retains encoded entities as text. Decode once,
  // using textContent only, never HTML; this cannot introduce elements or attributes.
  const walker = doc.createTreeWalker(doc.documentElement, 4);
  while (walker.nextNode())
    walker.currentNode.textContent = walker.currentNode.textContent!.replace(
      /&#(\d+);/g,
      (match, digits) => {
        const code = Number(digits);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      },
    );
  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function renderFlowSvg(source: string): Promise<string> {
  const existing = cache.get(source);
  if (existing) return existing;
  const pending = queue
    .catch(() => {})
    .then(async () => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden';
      document.body.append(host);
      try {
        await mermaid.parse(source);
        const { svg } = await mermaid.render(`flowrender${++serial}`, source, host);
        // Avoid DOMPurify treating the matching, still-mounted render ID as DOM clobbering.
        host.remove();
        return sanitizeFlowSvg(svg);
      } finally {
        host.remove();
      }
    });
  queue = pending;
  cache.set(source, pending);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  void pending.catch(() => {
    if (cache.get(source) === pending) cache.delete(source);
  });
  return pending;
}
