import { useEffect, useRef, useState } from 'react';

// A row of tabs on a screen with room, and a menu on one without.
//
// The dashboard has ten tabs and the assistant's desk has nine. Laid out as a
// row they come to about 500px, which is wider than every phone sold — so the
// whole page scrolled sideways and reaching Settings meant dragging the layout
// left. That is the complaint this exists to answer.
//
// A SCROLLING STRIP WAS THE OBVIOUS FIX AND IS NOT THIS. It keeps the sideways
// drag and merely confines it, hides most of the options off the edge, and
// gives no hint of how many are out there. On a screen this narrow the honest
// move is to stop pretending a row fits: show the tab you are on, and open the
// rest as a list where all nine are visible at once and each is a full-width
// target.
//
// The row is untouched above the breakpoint, because there it works.
//
// A tab may carry `attention: true`, which puts a dot on it. On the narrow
// layout the dot also goes on the closed menu button when it belongs to a tab
// the button is currently hiding — otherwise the one place a phone can show
// this is the one place it would not.

export default function Tabs({ tabs, active, onChange, label = 'Sections' }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const current = tabs.find((t) => t.id === active) || tabs[0];
  // Not counting the tab you are looking at: you are already there.
  const hiddenAttention = tabs.some((t) => t.attention && t.id !== current?.id);

  // Close on anything that means "I am done here": a click elsewhere, or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  function pick(id) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div className="tabs-shell">
      {/* Wide: the row, exactly as it was. */}
      <div className="tabs" role="tablist" aria-label={label}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={'tab-btn' + (t.id === active ? ' is-active' : '')}
            onClick={() => onChange(t.id)}
            type="button"
            role="tab"
            aria-selected={t.id === active}
          >
            {t.label}
            {t.attention && <span className="tab-dot" aria-label="needs attention" />}
          </button>
        ))}
      </div>

      {/* Narrow: where you are, and a way to the rest. */}
      <div className="tabs-menu" ref={menuRef}>
        <button
          type="button"
          className="tabs-current"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="true"
        >
          <span className="tabs-current-label">
            {current?.label}
            {current?.attention && <span className="tab-dot" aria-label="needs attention" />}
          </span>
          {hiddenAttention && <span className="tab-dot" aria-label="another section needs attention" />}
          <span className="tabs-current-caret" aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="tabs-list" role="menu" aria-label={label}>
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className={'tabs-list-item' + (t.id === active ? ' is-active' : '')}
                onClick={() => pick(t.id)}
              >
                {t.label}
                {t.attention && <span className="tab-dot" aria-label="needs attention" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
