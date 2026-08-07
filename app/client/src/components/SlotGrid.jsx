import { useMemo } from 'react';
import { dateKeyInZone, dayLabelInZone, timeLabelInZone } from '../lib/timezones.js';

export default function SlotGrid({ slots, timezone, selected, onSelect }) {
  const groupedByDay = useMemo(() => {
    if (!slots) return [];
    const groups = new Map();
    for (const slot of slots) {
      const key = dateKeyInZone(slot.startAt, timezone);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(slot);
    }
    return Array.from(groups.entries()).map(([key, daySlots]) => ({
      key,
      label: dayLabelInZone(daySlots[0].startAt, timezone),
      slots: daySlots,
    }));
  }, [slots, timezone]);

  if (slots === null) return <p className="hint">Loading available times…</p>;
  if (slots.length === 0) return <div className="empty-state">No open times in the next two weeks.</div>;

  return (
    <div>
      {groupedByDay.map((group) => (
        <div className="day-group" key={group.key}>
          <h3>{group.label}</h3>
          <div className="slot-grid">
            {group.slots.map((slot) => (
              <button
                key={slot.startAt}
                type="button"
                className={'slot-btn' + (selected?.startAt === slot.startAt ? ' is-selected' : '')}
                onClick={() => onSelect(slot)}
              >
                {timeLabelInZone(slot.startAt, timezone)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
