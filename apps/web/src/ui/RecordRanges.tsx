import type { RecordRange, ReturnContextViewModel } from '@statecarry/presentation';

export function RecordRanges({
  records,
  threadIds,
  ranges,
  onChange,
}: {
  records: NonNullable<ReturnContextViewModel['scope']['records']>;
  threadIds: string[];
  ranges: Record<string, RecordRange>;
  onChange: (ranges: Record<string, RecordRange>) => void;
}) {
  return (
    <>
      <p>
        Applying a smaller range withdraws the previous explanation and excluded evidence. Your
        written draft is preserved.
      </p>
      {threadIds.map((id) => (
        <fieldset key={id}>
          <legend>Included record range · {id}</legend>
          {(['start', 'end'] as const).map((edge) => (
            <label key={edge}>
              {edge === 'start' ? 'Start with this record' : 'Include through this record'}
              <select
                value={
                  records.find(
                    (r) =>
                      r.threadId === id &&
                      r.turnId === ranges[id]?.[edge]?.turnId &&
                      r.itemId === ranges[id]?.[edge]?.itemId,
                  )?.id ?? ''
                }
                onChange={(e) => {
                  const selected = records.find((r) => r.id === e.target.value),
                    first = records.find((r) => r.threadId === id);
                  if (!selected && edge === 'end' && ranges[id]) {
                    onChange({ ...ranges, [id]: { start: ranges[id].start } });
                    return;
                  }
                  if (!selected || !first) return;
                  const position = { turnId: selected.turnId, itemId: selected.itemId };
                  onChange({
                    ...ranges,
                    [id]: {
                      ...ranges[id],
                      start: ranges[id]?.start ?? { turnId: first.turnId, itemId: first.itemId },
                      [edge]: position,
                    },
                  });
                }}
              >
                <option value="">
                  {ranges[id]?.[edge]
                    ? 'Saved boundary · see source positions'
                    : edge === 'end'
                      ? 'Include later records'
                      : 'Use the approved starting turn'}
                </option>
                {records
                  .filter((r) => r.threadId === id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.actor} · {r.preview}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <details>
            <summary>Enter source positions manually</summary>
            {(['start', 'end'] as const).map((edge) => (
              <div key={edge}>
                {(['turnId', 'itemId'] as const).map((field) => (
                  <label key={field}>
                    {edge === 'start' ? 'First' : 'Last'} record{' '}
                    {field === 'turnId' ? 'turn' : 'item'}
                    <input
                      value={ranges[id]?.[edge]?.[field] ?? ''}
                      onChange={(e) =>
                        onChange({
                          ...ranges,
                          [id]: {
                            ...ranges[id],
                            start: ranges[id]?.start ?? { turnId: '', itemId: '' },
                            [edge]: {
                              turnId: '',
                              itemId: '',
                              ...ranges[id]?.[edge],
                              [field]: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            ))}
          </details>
          <button
            type="button"
            onClick={() => {
              const next = { ...ranges };
              delete next[id];
              onChange(next);
            }}
          >
            Use starting turn and later records
          </button>
          <p className="small">
            A last record closes the range. Later records stay excluded. Missing boundaries require
            review and never expand the range.
          </p>
        </fieldset>
      ))}
      <p className="small">
        Use turn and item positions from the source details. Non-contiguous selections and mixed
        goals inside one record are not supported; keep those records separate.
      </p>
    </>
  );
}
