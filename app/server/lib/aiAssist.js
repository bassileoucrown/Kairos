// AI Scheduling Assistant (blueprint Section 3.2): "Natural-language
// prompts; PA approves every output — never autonomous."
//
// There's no LLM API key configured in this environment, so this is a
// pattern-based parser rather than a model call — but it's a real, working
// feature, not a stub: it extracts a contact, a meeting type, and a
// date/time hint from plain text, then filters the actual computed open
// slots (the same engine the public booking page uses) down to real
// candidates. It never books anything itself; every candidate still
// requires an explicit PA click in routes/pa.js's booking endpoint. Swap in
// a real model call here later (e.g. behind an ANTHROPIC_API_KEY check) for
// better extraction on messier phrasing — the contract (return contact/
// meetingType guesses + a slot filter) stays the same either way.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TIME_OF_DAY_WINDOWS = {
  morning: [5, 12],
  afternoon: [12, 17],
  evening: [17, 21],
  night: [17, 23],
};

function findContactMatch(message, contacts) {
  const lower = message.toLowerCase();
  let best = null;
  for (const c of contacts) {
    const name = (c.name || '').toLowerCase().trim();
    const firstName = name.split(/\s+/)[0];
    if (name && lower.includes(name)) return c;
    if (firstName && firstName.length > 2 && lower.includes(firstName)) best = best || c;
    if (lower.includes(c.email.toLowerCase())) return c;
  }
  return best;
}

function findMeetingTypeMatch(message, meetingTypes) {
  const lower = message.toLowerCase();
  for (const mt of meetingTypes) {
    if (mt.name && lower.includes(mt.name.toLowerCase())) return mt;
  }
  return null;
}

function findWeekdayHint(message) {
  const lower = message.toLowerCase();
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (lower.includes(WEEKDAYS[i]) || lower.includes(WEEKDAYS[i].slice(0, 3))) {
      return i;
    }
  }
  return null;
}

function findTimeOfDayHint(message) {
  const lower = message.toLowerCase();
  for (const key of Object.keys(TIME_OF_DAY_WINDOWS)) {
    if (lower.includes(key)) return key;
  }
  return null;
}

function findExplicitTime(message) {
  const match = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(message);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const isPm = /pm/i.test(match[3]);
  if (isPm && hour < 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;
  return { hour, minute };
}

function parseRequest(message, { contacts, meetingTypes }) {
  return {
    contact: findContactMatch(message, contacts),
    meetingType: findMeetingTypeMatch(message, meetingTypes) || meetingTypes[0] || null,
    isToday: /\btoday\b/i.test(message),
    isTomorrow: /\btomorrow\b/i.test(message),
    weekday: findWeekdayHint(message),
    timeOfDay: findTimeOfDayHint(message),
    explicitTime: findExplicitTime(message),
  };
}

// Filters real computed slots (see lib/availability.js) down to whichever
// candidates match the parsed hints, in the given display timezone.
function filterSlots(slots, hints, timezone) {
  let candidates = slots;

  if (hints.isToday || hints.isTomorrow || hints.weekday !== null) {
    candidates = candidates.filter((s) => {
      const d = new Date(s.startUtc);
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(d);
      const weekdayIndex = WEEKDAYS.findIndex((w) => w.toLowerCase() === parts.toLowerCase());
      if (hints.weekday !== null) return weekdayIndex === hints.weekday;

      const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d);
      const now = new Date();
      const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(tomorrow);
      if (hints.isToday) return dateKey === todayKey;
      if (hints.isTomorrow) return dateKey === tomorrowKey;
      return true;
    });
  }

  if (hints.timeOfDay) {
    const [start, end] = TIME_OF_DAY_WINDOWS[hints.timeOfDay];
    candidates = candidates.filter((s) => {
      const hour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(new Date(s.startUtc)), 10);
      return hour >= start && hour < end;
    });
  }

  if (hints.explicitTime) {
    candidates = candidates.filter((s) => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(s.startUtc));
      const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
      return parseInt(map.hour, 10) === hints.explicitTime.hour;
    });
  }

  return candidates;
}

module.exports = { parseRequest, filterSlots, WEEKDAYS };
