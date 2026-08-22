import { useMemo } from 'react';
import { dateKeyInZone, dayLabelInZone, timeLabelInZone } from '../lib/timezones.js';

// How long a stretch of days reads as, in the sentence "no open times in the
// next ___". Said the way somebody would say it rather than as a number of
// days, which is how "in the next 1 days" gets shipped.
function spanWords(days) {
  if (!days) return 'the next couple of weeks';
  if (days === 1) return 'the next day';
  if (days === 7) return 'the next week';
  if (days === 14) return 'the next two weeks';
  if (days === 30 || days === 31) return 'the next month';
  if (days % 30 === 0) return `the next ${days / 30} months`;
  if (days % 7 === 0) return `the next ${days / 7} weeks`;
  return `the next ${days} days`;
}

export default function SlotGrid({ slots, timezone, selected, onSelect, windowDays = null }) {
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
  // The window is the principal's choice now, so this sentence has to read it
  // rather than repeat the constant it used to be.
  if (slots.length === 0) return <div className="empty-state">No open times in {spanWords(windowDays)}.</div>;

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
