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

export default function Tabs({ tabs, active, onChange, label = 'Sections' }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const current = tabs.find((t) => t.id === active) || tabs[0];

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
          <span className="tabs-current-label">{current?.label}</span>
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
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
