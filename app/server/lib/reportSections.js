// What a report is made of, and which parts of it somebody asked for.
//
// The report has always been one fixed document: everything, in one order,
// every time. That is right when nobody has asked for anything in particular
// and wrong the moment they have — an EA building a board pack wants what the
// office did, an accountant wants the counts and none of the prose, and a
// principal checking their own custody wants the trail and nothing else.
//
// SO THE PARTS ARE NAMED, ONCE, HERE. The screen offers them, the export
// renders them and the access rule filters them from this one list. Three
// copies of "what a section is" would drift the way two queries answering one
// question always drift in this codebase, and the way it would drift is a
// document containing a part the reader was not entitled to.
//
// NOT ASKING IS NOT THE SAME AS ASKING FOR NOTHING. Somebody who names no
// section gets the whole report, segmented — which is what the report already
// was, and what anybody expects from a thing called "the report". An empty
// selection is the one interpretation nobody means.

/**
 * `ownerOnly` is the custody trail, and it is a different question from who
 * may see the office. The counts already tell a Chief of Staff that three
 * documents were opened; the trail says WHICH — that the passport was revealed
 * on Tuesday — and that is the principal's own record of their own essentials.
 * See routes/report.js, which owns that decision; this only records which
 * section it governs.
 */
const SECTIONS = [
  {
    id: 'office',
    label: 'What the office did',
    what: 'Every person appointed here, and what each of them got through in the period.',
  },
  {
    id: 'open',
    label: 'Still open now',
    what: 'Approvals waiting, tasks overdue, and records nobody has answered — counted as they '
      + 'stand today rather than as they stood on Sunday night.',
  },
  {
    id: 'trail',
    label: 'Who looked at what',
    what: 'Every reveal of something held in Essentials: who opened it, and when.',
    ownerOnly: true,
  },
  {
    id: 'ahead',
    label: 'The week ahead',
    what: 'Appointments, tasks and stages falling due, travel, and anything lapsing.',
  },
  {
    id: 'attention',
    label: 'Needs attention',
    what: 'What has been sitting untouched long enough to be worth naming.',
  },
];

const IDS = SECTIONS.map((s) => s.id);

/** The sections this reader may have at all, in the order a report reads. */
function availableTo({ canSeeTrail = false } = {}) {
  return SECTIONS.filter((s) => !s.ownerOnly || canSeeTrail);
}

/**
 * Which sections to build, from what was asked for.
 *
 * AN UNAVAILABLE SECTION IS INDISTINGUISHABLE FROM A MADE-UP ONE. Asking for
 * the trail without being entitled to it is ignored in exactly the way asking
 * for `?sections=nonsense` is ignored — not refused, not reported as dropped.
 * Saying "that part exists but is not for you" is itself the disclosure the
 * gate exists to prevent, and this codebase's rule is that a thing you cannot
 * see is absent rather than forbidden.
 *
 * AND AN EMPTY RESULT FALLS BACK TO EVERYTHING, for the same reason: somebody
 * who asked only for a section they cannot have would otherwise receive a
 * document with nothing in it, which announces the refusal by its shape. They
 * get the report they are entitled to, and the header says it is the whole
 * thing, which is true.
 */
function resolve(asked, { canSeeTrail = false } = {}) {
  const available = availableTo({ canSeeTrail });
  const permitted = new Set(available.map((s) => s.id));

  const wanted = String(asked || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Filtered through the canonical order rather than the order they were
  // typed: a report whose parts appear in whatever sequence the query string
  // happened to use is a different document each time it is asked for.
  const chosen = wanted.length
    ? IDS.filter((id) => permitted.has(id) && wanted.includes(id))
    : [];

  if (chosen.length === 0) {
    return { chosen: available.map((s) => s.id), whole: true, available };
  }
  return {
    chosen,
    // `whole` is about what the document CONTAINS, not about what was typed.
    // Ticking every box by hand produces the whole report and should say so.
    whole: chosen.length === available.length,
    available,
  };
}

/** The label for one id, for a document that has to name its own parts. */
function labelFor(id) {
  const s = SECTIONS.find((x) => x.id === id);
  return s ? s.label : id;
}

module.exports = { SECTIONS, IDS, availableTo, resolve, labelFor };
