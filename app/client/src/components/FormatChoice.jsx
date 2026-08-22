// Choosing how a meeting happens.
//
// The same control serves both halves of the conversation: the booker saying
// how they would like to meet, and the office suggesting something else. They
// are the same question asked by different people, so they are the same
// component — a second, near-identical picker in the approval queue would have
// drifted from this one within a month.
//
// Radios rather than a select. There are four options with a sentence of
// explanation each, and a select hides both the count and the explanations
// behind a tap.
export default function FormatChoice({
  formats,
  value,
  onChange,
  note,
  onNote,
  idPrefix,
  legend = 'How would you like to meet?',
  // The office cannot counter with the thing that was already asked for, so
  // that option is shown struck through rather than quietly missing — a
  // vanished option looks like a bug.
  alreadyAskedId = null,
  noteLabel = 'What do you have in mind?',
}) {
  if (!formats || formats.length === 0) return null;
  const chosen = formats.find((f) => f.id === value);

  return (
    <fieldset className="format-choice">
      <legend>{legend}</legend>
      {formats.map((f) => {
        const isTaken = f.id === alreadyAskedId;
        return (
          <label
            key={f.id}
            className={'format-option' + (value === f.id ? ' is-chosen' : '') + (isTaken ? ' is-taken' : '')}
            htmlFor={`${idPrefix}-${f.id}`}
          >
            <input
              id={`${idPrefix}-${f.id}`}
              type="radio"
              name={`${idPrefix}-format`}
              value={f.id}
              checked={value === f.id}
              disabled={isTaken}
              onChange={() => onChange(f.id)}
            />
            <span className="format-body">
              <span className="format-label">
                {f.label}
                {f.isUsual && <span className="pill">usual</span>}
              </span>
              <span className="format-hint">
                {isTaken ? 'This is what they asked for — approve it instead.' : f.hint}
              </span>
            </span>
          </label>
        );
      })}

      {chosen?.needsNote && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor={`${idPrefix}-note`}>{noteLabel}</label>
          <textarea
            id={`${idPrefix}-note`}
            value={note}
            maxLength={300}
            rows={2}
            onChange={(e) => onNote(e.target.value)}
            required
          />
        </div>
      )}
    </fieldset>
  );
}
