// The report as a file you can keep, send to an accountant, or put in a board pack.
//
// WHY A FILE AT ALL. A screen is for reading; a file is for keeping and for
// giving to somebody who does not have an account here. A family office
// reporting to a principal's lawyer, an EA building a board pack, a principal
// who wants last quarter on paper — none of them can use a URL behind a login.
//
// TWO FORMATS, because they answer different questions. The HTML document is
// the report as a person reads it, styled, printable straight to PDF from any
// browser, and it carries the whole thing including what is coming and what
// has been neglected. The CSV is the numbers only, because a spreadsheet is
// what somebody reaches for when they want to compare four weeks and no
// prose will help them do it.
//
// THE ACCESS DECISION IS NOT MADE HERE. This file renders whatever it is
// handed. Who may see whose line is decided once, in routes/report.js, and
// both the screen and the export go through that same decision — an export
// route that rebuilt the rule would be the same "two answers to one question"
// drift that has bitten this codebase repeatedly, except that here the drift
// hands somebody a file containing the whole office.

/** HTML-escape. Names and titles are user text and go into markup. */
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * One CSV cell.
 *
 * THE LEADING APOSTROPHE IS NOT A TYPO. A cell beginning =, +, - or @ is
 * executed as a formula when the file is opened in Excel or Sheets, so a
 * thread named "=HYPERLINK(...)" becomes code running on the machine of
 * whoever opened the principal's report. Every field here is text somebody
 * typed into the app, which makes this the exact shape of that attack.
 */
function cell(v) {
  let s = String(v === null || v === undefined ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// The counts, in the order a person reads them and with the words the screen
// uses. One list, so the CSV header and the HTML table cannot drift apart.
const COLUMNS = [
  ['putIn', 'Appointments made'],
  ['approved', 'Approved'],
  ['declined', 'Declined'],
  ['moved', 'Moved'],
  ['calledOff', 'Called off'],
  ['tasksDone', 'Tasks finished'],
  ['tasksSet', 'Tasks given out'],
  ['messages', 'Messages'],
  ['records', 'Records filed'],
  ['documentsAdded', 'Documents added'],
  ['documentsConfirmed', 'Documents confirmed'],
  ['documentsRevealed', 'Documents revealed'],
  ['houseInstructions', 'House instructions'],
  ['keptToArchive', 'Kept to the archive'],
];

function toCsv(report) {
  const rows = [
    ['Kairos — the week of', report.window.startDate, 'to', report.window.endDate].map(cell).join(','),
    [`Office of ${report.principal.name}`].map(cell).join(','),
    '',
    ['Person', 'Role', ...COLUMNS.map(([, label]) => label)].map(cell).join(','),
  ];
  for (const p of report.people) {
    rows.push([p.name, p.roleLabel, ...COLUMNS.map(([key]) => p.counts[key] ?? 0)].map(cell).join(','));
  }
  // The tail matters more than the table and a CSV that dropped it would be a
  // flattering document. Kept as labelled rows rather than a second table:
  // one sheet, read top to bottom.
  rows.push('', ['Still open now'].map(cell).join(','));
  rows.push(['Approvals waiting', report.stillOpen.approvalsWaiting].map(cell).join(','));
  rows.push(['Tasks overdue', report.stillOpen.tasksOverdue].map(cell).join(','));
  rows.push(['Records nobody has answered', report.stillOpen.recordsOpen].map(cell).join(','));

  if (report.ahead) {
    rows.push('', [`The week ahead — ${report.ahead.window.startDate} to ${report.ahead.window.endDate}`]
      .map(cell).join(','));
    rows.push(['Appointments', report.ahead.appointments].map(cell).join(','));
    rows.push(['Away', report.ahead.trips.map((t) => t.name).join('; ') || 'Not travelling'].map(cell).join(','));
    rows.push('', ['Needs attention', 'Why', 'Due'].map(cell).join(','));
    for (const n of report.ahead.neglected.items) {
      rows.push([n.title, n.why, n.dueAt || ''].map(cell).join(','));
    }
  }
  // A BOM, so Excel opens a Lagos name with an accent in it correctly instead
  // of as mojibake. Without this the file is right and looks wrong, which
  // nobody will believe.
  return '﻿' + rows.join('\r\n') + '\r\n';
}

function countsTable(people) {
  return `
  <table>
    <thead><tr><th>Person</th><th>Role</th>${COLUMNS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
    <tbody>
      ${people.map((p) => `<tr${p.quiet ? ' class="quiet"' : ''}>
        <td>${esc(p.name)}</td><td>${esc(p.roleLabel)}</td>
        ${COLUMNS.map(([k]) => `<td class="n">${esc(p.counts[k] ?? 0)}</td>`).join('')}
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function toHtml(report) {
  const a = report.ahead;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Kairos — week of ${esc(report.window.startDate)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #1a1a1a; background: #fff; margin: 0; padding: 32px; }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; text-transform: uppercase;
       letter-spacing: 0.06em; color: #6b6b6b; }
  .sub { color: #6b6b6b; margin: 0 0 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border-bottom: 1px solid #e5e5e5; padding: 6px 8px; text-align: left; }
  th { color: #6b6b6b; font-weight: 600; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  tr.quiet td { color: #9a9a9a; }
  ul { margin: 6px 0; padding-left: 18px; }
  li { margin-bottom: 5px; }
  .why { color: #6b6b6b; }
  .tiles { display: flex; gap: 24px; flex-wrap: wrap; margin: 8px 0; }
  .tile strong { display: block; font-size: 24px; }
  .tile span { color: #6b6b6b; font-size: 12px; }
  .foot { margin-top: 36px; color: #9a9a9a; font-size: 11px;
          border-top: 1px solid #e5e5e5; padding-top: 10px; }
  /* Printed to PDF far more often than it is read in a browser, so the print
     view is the real one: no page margin fighting the browser's own, and no
     row split across a page break. */
  @media print {
    body { padding: 0; }
    tr, li { break-inside: avoid; }
  }
</style></head>
<body><div class="wrap">
  <h1>The week of ${esc(report.window.startDate)} to ${esc(report.window.endDate)}</h1>
  <p class="sub">Office of ${esc(report.principal.name)} · times in ${esc(report.window.timeZone)}</p>

  <h2>What the office did</h2>
  ${report.people.length ? countsTable(report.people) : '<p class="sub">Nobody is appointed to this office yet.</p>'}

  <h2>Still open now</h2>
  <div class="tiles">
    <div class="tile"><strong>${esc(report.stillOpen.approvalsWaiting)}</strong><span>approvals waiting</span></div>
    <div class="tile"><strong>${esc(report.stillOpen.tasksOverdue)}</strong><span>tasks overdue</span></div>
    <div class="tile"><strong>${esc(report.stillOpen.recordsOpen)}</strong><span>records nobody has answered</span></div>
  </div>
  ${report.stillOpen.records.length ? `<ul>${report.stillOpen.records.map((r) => `
    <li><strong>${esc(r.threadName)}</strong> — ${esc(r.body)}
      <span class="why">· ${esc(r.authorName)}, ${esc(String(r.at).slice(0, 10))}</span></li>`).join('')}</ul>` : ''}

  ${a ? `
  <h2>The week ahead — ${esc(a.window.startDate)} to ${esc(a.window.endDate)}</h2>
  <div class="tiles">
    <div class="tile"><strong>${esc(a.appointments)}</strong><span>appointments</span></div>
    <div class="tile"><strong>${esc(a.tasksDue.length + a.moreTasksDue)}</strong><span>tasks fall due</span></div>
    <div class="tile"><strong>${esc(a.stagesDue.length + a.moreStagesDue)}</strong><span>stages fall due</span></div>
  </div>
  ${a.trips.length ? `<p>Away: ${a.trips.map((t) => `${esc(t.name)} (${esc(t.startsOn)}&ndash;${esc(t.endsOn)})`).join(', ')}</p>` : '<p class="sub">Not travelling.</p>'}
  ${a.expiring.length ? `<p><strong>Lapsing this week:</strong> ${a.expiring.map((e) => `${esc(e.label)} (${esc(e.expiresOn)})`).join(', ')}</p>` : ''}

  <h2>Needs attention${a.neglected.total > a.neglected.items.length
    ? ` — showing ${a.neglected.items.length} of ${a.neglected.total}` : ''}</h2>
  ${a.neglected.items.length ? `<ul>${a.neglected.items.map((n) => `
    <li><strong>${esc(n.title)}</strong><br><span class="why">${esc(n.why)}${n.dueAt
      ? ` · due ${esc(String(n.dueAt).slice(0, 10))}` : ''}</span></li>`).join('')}</ul>`
    : '<p class="sub">Nothing is sitting untouched. This is the good outcome, not an empty section.</p>'}
  ` : ''}

  <p class="foot">
    Kairos by Exousia · generated ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC.
    ${report.scope === 'self'
      ? 'This copy covers your own line only.'
      : 'This copy covers the whole office.'}
    Counted from what the app already records; nothing is logged specially to produce it.
  </p>
</div></body></html>`;
}

/** filename-safe, and dated so two downloads do not overwrite each other. */
function filename(report, ext) {
  const who = String(report.principal.name || 'office').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'office';
  return `kairos-${who}-${report.window.startDate}.${ext}`;
}

module.exports = { toCsv, toHtml, filename, COLUMNS };
