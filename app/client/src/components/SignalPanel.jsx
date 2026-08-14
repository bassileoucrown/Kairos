// The thing both people are looking at.
//
// One component, rendered on the driver's phone held up screen-out and on the
// principal's phone held low in a walking hand. Identical on purpose: the
// whole mechanism is "these two match", and a panel that looked different on
// each side would make the principal work out an equivalence instead of
// recognising one.
//
// Colour is never the only channel. The shape carries the same information for
// a principal who cannot separate red from green, for a screen at minimum
// brightness, and for a hall lit by sodium lamps that turns everything amber.
// Both are also written out in words underneath, because at forty metres you
// see the panel and at one metre you can read what it claims to be.

const SHAPE_PATHS = {
  circle: <circle cx="50" cy="50" r="34" />,
  square: <rect x="17" y="17" width="66" height="66" rx="7" />,
  triangle: <polygon points="50,13 89,83 11,83" />,
  diamond: <polygon points="50,9 91,50 50,91 9,50" />,
  cross: <path d="M38 11h24v27h27v24H62v27H38V62H11V38h27z" />,
  star: (
    <polygon points="50,10 59.4,37.1 88,37.6 65.2,54.9 73.5,82.4 50,66 26.5,82.4 34.8,54.9 12,37.6 40.6,37.1" />
  ),
};

/**
 * @param signal   what the server says to show right now
 * @param size     'full' for the driver's held-up phone, 'inline' elsewhere
 * @param muted    drawn flat, for the found state where the panel is no
 *                 longer the thing being matched
 */
export default function SignalPanel({ signal, size = 'inline', muted = false }) {
  if (!signal?.colour) return null;
  const { colour, shape } = signal;
  return (
    <div
      className={`signal-panel signal-${size}${muted ? ' is-muted' : ''}`}
      style={{ background: colour.hex, color: colour.ink }}
      aria-label={`${colour.name} with a ${shape.name.toLowerCase()}`}
    >
      <svg viewBox="0 0 100 100" role="presentation" focusable="false">
        <g fill={colour.ink}>{SHAPE_PATHS[shape.id]}</g>
      </svg>
      <span className="signal-words">{colour.name} · {shape.name}</span>
    </div>
  );
}
