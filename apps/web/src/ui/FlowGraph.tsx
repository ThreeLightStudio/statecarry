import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { presentFlowGraph, type FlowView } from '@statecarry/presentation';

export default function FlowGraph({
  flow,
  onSelect,
  onFallback,
  detailsId,
}: {
  flow: FlowView;
  onSelect: (ids: string[], returnTarget: HTMLButtonElement) => void;
  onFallback: (message: string) => void;
  detailsId: string;
}) {
  const graph = useMemo(() => presentFlowGraph(flow), [flow]);
  const [svg, setSvg] = useState(''),
    [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState(
    () =>
      graph.nodes.find((n) =>
        n.itemIds.includes(flow.items.find((i) => i.claimId === flow.claimId)?.id ?? ''),
      )?.id,
  );
  const canvas = useRef<HTMLDivElement>(null);
  const nodeList = useRef<HTMLDivElement>(null);
  const helpId = useId();
  useEffect(() => {
    let active = true;
    if (!graph.connected) {
      onFallback(graph.limitation!);
      return;
    }
    import('./flow-renderer')
      .then((renderer) => renderer.renderFlowSvg(graph.source))
      .then((value) => {
        if (active) setSvg(value);
      })
      .catch(() => {
        if (active)
          onFallback(
            'The graph could not be displayed. The same information is available as text.',
          );
      });
    return () => {
      active = false;
    };
  }, [graph, onFallback]);
  useEffect(() => {
    for (const node of canvas.current?.querySelectorAll<SVGGElement>('g.node') ?? []) {
      const id = /^(?:flowrender\d+-)?flowchart-([ns]\d+)-\d+$/.exec(node.id)?.[1];
      node.classList.toggle('flow-node-selected', id === selected);
    }
  }, [svg, selected]);
  const select = (id: string) => {
    const node = graph.nodes.find((n) => n.id === id);
    const returnTarget = nodeList.current?.querySelector<HTMLButtonElement>(
      `button[data-node-id="${id}"]`,
    );
    if (node && returnTarget) {
      setSelected(id);
      onSelect(node.itemIds, returnTarget);
    }
  };
  if (!graph.connected) return null;
  return (
    <section aria-label="Conversation relationships">
      <p className="small muted">
        Lines mean items cite the same source version. They do not establish chronology, causality
        or replacement of a decision. Select a shared source to see linked items.
      </p>
      <p id={helpId} className="small">
        Long titles end with an ellipsis. Select a node or an item below to read its full text,
        conditions and source limitations. Scroll the graph horizontally or vertically.
      </p>
      <div className="button-row">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
          disabled={zoom <= 0.25}
        >
          Zoom out
        </button>
        <button type="button" onClick={() => setZoom(1)}>
          Reset zoom
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          disabled={zoom >= 3}
        >
          Zoom in
        </button>
        <span role="status">{Math.round(zoom * 100)}%</span>
      </div>
      {!svg ? <p role="status">Loading the graph.</p> : null}
      <div
        className="flow-graph-scroll"
        tabIndex={0}
        role="region"
        aria-label="Scrollable graph. You can also select items using the buttons below."
      >
        <div
          ref={canvas}
          className="flow-graph-canvas"
          style={{ zoom }}
          aria-hidden="true"
          onClick={(event) => {
            const node = (event.target as Element).closest('g.node');
            const id = node && /^(?:flowrender\d+-)?flowchart-([ns]\d+)-\d+$/.exec(node.id)?.[1];
            if (id) select(id);
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div
        ref={nodeList}
        className="flow-node-list"
        role="group"
        aria-label="Select graph item"
        aria-describedby={helpId}
      >
        {graph.nodes.map((node) => (
          <button
            type="button"
            key={node.id}
            data-node-id={node.id}
            aria-controls={detailsId}
            aria-pressed={selected === node.id}
            onClick={() => select(node.id)}
          >
            {node.label}
          </button>
        ))}
      </div>
    </section>
  );
}
