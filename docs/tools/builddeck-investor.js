// Kairos — investor deck, September 2026.
//
// Built from the August deck's own palette and typeface so it reads as the
// same document brought up to date rather than a different one: navy 0A1A2F,
// gold B8944D, teal 1A6E6E, Arial throughout, 13.33 x 7.5.
//
// WHAT CHANGED, AND WHY. The August deck describes "a fully designed 39-screen
// product" — designs. That is the single most out-of-date sentence in it: the
// product is built, tested on two database backends, and deployed. Two slides
// carried a note reading "do not send this deck to an investor until this
// slide is complete". Both are replaced with something honest and presentable.
//
// WHAT IS DELIBERATELY NOT CLAIMED. There is no billing in the product and
// there are no paying customers. Tier enforcement is switched off on purpose
// so pilot testers reach every feature. Every revenue figure in here is
// labelled as an assumption with its arithmetic shown, because a pre-seed deck
// that implies revenue it does not have is the one thing that cannot be
// walked back in a second meeting.

const pptxgen = require('pptxgenjs');

const NAVY = '0A1A2F';
const GOLD = 'B8944D';
const TEAL = '1A6E6E';
const PAPER = 'F7F8FA';
const SLATE = '3D4756';
const MUTED = '5C6B80';
const PALE = '9AA4B2';
const LINE = 'D8DEE8';
const WHITE = 'FFFFFF';

const W = 13.333;
const H = 7.5;
const M = 0.75;             // page margin
const COL = W - M * 2;

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'Exousia Prime Emporium Ltd';
pres.company = 'Exousia Prime Emporium Ltd';
pres.title = 'Kairos — Investor Deck';

let n = 0;
const TOTAL = 20;

/** A fresh shadow every time: pptxgenjs mutates the object it is handed. */
const soft = () => ({ type: 'outer', color: '0A1A2F', blur: 12, offset: 2, angle: 90, opacity: 0.08 });

function foot(s, dark = false) {
  n += 1;
  s.addText(`KAIROS · SEED   ${n} / ${TOTAL}`, {
    x: M, y: H - 0.52, w: COL, h: 0.3, align: 'right',
    fontFace: 'Arial', fontSize: 9, charSpacing: 1.2,
    color: dark ? '4A5568' : PALE, isTextBox: true, margin: 0,
  });
}

/**
 * How many lines a string takes at a given size in a box `w` inches wide.
 *
 * Bold Arial averages about 0.52em per character. This is an estimate and it
 * is meant to be: it only has to be right enough that a title box is never
 * SHORTER than its text, because a text box that is too short does not clip —
 * pptxgenjs centres the text in it and the overflow lands on whatever is above
 * and below. That is exactly how the first render put a three-line title
 * through both its own eyebrow and its standfirst.
 */
function lineCount(text, pt, w, em = 0.52) {
  const perLine = Math.max(1, Math.floor(w / ((pt * em) / 72)));
  return text.split('\n').reduce((total, para) => {
    const words = para.split(' ');
    let lines = 1, len = 0;
    for (const word of words) {
      const add = len === 0 ? word.length : word.length + 1;
      if (len + add > perLine) { lines += 1; len = word.length; } else { len += add; }
    }
    return total + lines;
  }, 0);
}

/** A light content page: eyebrow, title, standfirst. Returns the next free y. */
function page(s, eyebrow, title, standfirst) {
  s.background = { color: WHITE };
  s.addText(eyebrow, {
    x: M, y: 0.52, w: COL, h: 0.26,
    fontFace: 'Arial', fontSize: 11, bold: true, charSpacing: 1.8,
    color: GOLD, isTextBox: true, margin: 0, valign: 'top',
  });
  // 0.475em, not the 0.52 a table of Arial metrics suggests: measured off the
  // rendered slides, bold Arial at 30pt actually sets about 60 characters
  // across this column. Over-estimating is not free — it costs a phantom
  // second line, and the standfirst then floats half an inch below a
  // one-line title, which is what the second render showed on two slides.
  const tLines = lineCount(title, 30, COL, 0.475);
  const tHeight = tLines * 0.50;
  s.addText(title, {
    x: M, y: 0.84, w: COL, h: tHeight,
    fontFace: 'Arial', fontSize: 30, bold: true, color: NAVY,
    isTextBox: true, margin: 0, valign: 'top',
  });
  let y = 0.84 + tHeight + 0.16;
  if (standfirst) {
    const sHeight = lineCount(standfirst, 13.5, COL, 0.50) * 0.30;
    s.addText(standfirst, {
      x: M, y, w: COL, h: sHeight,
      fontFace: 'Arial', fontSize: 13.5, color: MUTED, lineSpacing: 19,
      isTextBox: true, margin: 0, valign: 'top',
    });
    y += sHeight + 0.30;
  } else {
    y += 0.16;   // a title with nothing under it still needs air beneath it
  }
  return y;
}

/** A tinted card. The motif: no stripes, no rules — a tint and a soft shadow. */
function card(s, x, y, w, h, fill = PAPER) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: fill }, line: { color: LINE, width: 0.75 }, shadow: soft(),
  });
}

/** The gold numeral that marks a step or a point. */
function marker(s, x, y, label, dark = false) {
  s.addShape(pres.ShapeType.ellipse, {
    x, y, w: 0.34, h: 0.34,
    fill: { color: dark ? GOLD : NAVY }, line: { color: dark ? GOLD : NAVY, width: 0 },
  });
  s.addText(String(label), {
    x, y, w: 0.34, h: 0.34, align: 'center', valign: 'middle',
    fontFace: 'Arial', fontSize: 11, bold: true,
    color: dark ? NAVY : WHITE, isTextBox: true, margin: 0,
  });
}

/** A table with the deck's own manners: no grid, generous rows, gold header. */
function table(s, x, y, w, cols, rows, opts = {}) {
  const head = cols.map((c) => ({
    text: c.label,
    options: {
      fontFace: 'Arial', fontSize: 10.5, bold: true, color: WHITE,
      fill: { color: NAVY }, align: c.align || 'left',
      margin: [11, 10, 11, 10], charSpacing: 0.8,
    },
  }));
  const body = rows.map((r, i) => r.map((cell, j) => ({
    text: String(cell),
    options: {
      fontFace: 'Arial',
      fontSize: opts.fontSize || 11,
      color: j === 0 ? NAVY : SLATE,
      bold: j === 0 || (opts.boldLast && i === rows.length - 1),
      fill: { color: i % 2 ? WHITE : PAPER },
      align: cols[j].align || 'left',
      margin: [11, 10, 11, 10],
    },
  })));
  s.addTable([head, ...body], {
    x, y, w,
    colW: cols.map((c) => c.w),
    border: { type: 'solid', color: LINE, pt: 0.5 },
    autoPage: false,
  });
}

// ═══════════════════════════════════════════════════════════════ 1 · TITLE
{
  const s = pres.addSlide();
  s.background = { color: NAVY };
  s.addText('EXOUSIA PRIME EMPORIUM LTD', {
    x: M, y: 1.5, w: COL, h: 0.3,
    fontFace: 'Arial', fontSize: 11, bold: true, charSpacing: 2.4,
    color: GOLD, isTextBox: true, margin: 0,
  });
  s.addText('Kairos.', {
    x: M, y: 2.0, w: COL, h: 1.5,
    fontFace: 'Arial', fontSize: 84, bold: true, color: WHITE,
    isTextBox: true, margin: 0,
  });
  s.addText(
    'Scheduling and custody infrastructure for Africa’s highest-demand leaders — '
    + 'built, tested and deployed.',
    {
      x: M, y: 3.5, w: 8.6, h: 0.9,
      fontFace: 'Arial', fontSize: 18, color: 'C7CFDB', lineSpacing: 27,
      isTextBox: true, margin: 0,
    },
  );
  s.addText('SEED ROUND · SEPTEMBER 2026 · CONFIDENTIAL', {
    x: M, y: 4.75, w: COL, h: 0.3,
    fontFace: 'Arial', fontSize: 10.5, bold: true, charSpacing: 1.8,
    color: PALE, isTextBox: true, margin: 0,
  });
  s.addText('Bassileou Ayomikun Crown  ·  +234 814 160 9122  ·  bassileoucrown@gmail.com', {
    x: M, y: 5.9, w: COL, h: 0.3,
    fontFace: 'Arial', fontSize: 12, color: '8A94A6', isTextBox: true, margin: 0,
  });
  foot(s, true);
  s.addNotes('The one sentence that changed since August: it is built. '
    + 'Everything in this deck can be opened and used today.');
}

// ═══════════════════════════════════════════════════════════ 2 · PROBLEM
{
  const s = pres.addSlide();
  const y = page(s, 'THE PROBLEM',
    'Every scheduling tool is built for the person booking, not the person whose time is being protected.',
    'Calendly, Cal.com and Acuity treat all bookings as equal, ignore the assistant who does the real '
    + 'work, and carry no memory of who matters.');

  const items = [
    ['The booker holds the power',
      'Existing tools let anyone take a slot. A stranger and a board member are treated identically.'],
    ['The assistant is an afterthought',
      'The person actually running the diary gets a restricted owner-view, not a workspace of their own.'],
    ['No context, and nothing protected',
      'No buffers, no protected hours, no relationship memory, no custody of anything sensitive.'],
  ];
  const cw = (COL - 0.6) / 3;
  items.forEach(([h1, body], i) => {
    const x = M + i * (cw + 0.3);
    card(s, x, y + 0.15, cw, 2.7);
    marker(s, x + 0.4, y + 0.55, i + 1);
    s.addText(h1, {
      x: x + 0.4, y: y + 1.05, w: cw - 0.8, h: 0.6,
      fontFace: 'Arial', fontSize: 15, bold: true, color: NAVY, isTextBox: true, margin: 0,
    });
    s.addText(body, {
      x: x + 0.4, y: y + 1.72, w: cw - 0.8, h: 1.0,
      fontFace: 'Arial', fontSize: 12, color: SLATE, lineSpacing: 17, isTextBox: true, margin: 0,
    });
  });
  foot(s);
}

// ═══════════════════════════════════════════════════════════ 3 · INSIGHT
{
  const s = pres.addSlide();
  const y = page(s, 'THE INSIGHT',
    'Invert the model. Build for the principal and the assistant first.',
    'Kairos closes five gaps every existing tool leaves open — and each one is a reason a serious '
    + 'professional switches and stays.');

  table(s, M, y + 0.1, COL,
    [{ label: 'The gap in every existing tool', w: 5.2 }, { label: 'How Kairos closes it', w: COL - 5.2 }],
    [
      ['Treats all bookings as equal', 'Four-tier access — a stranger is not a board member'],
      ['The assistant is a bolted-on permission', 'A first-class workspace, with its own desk and queue'],
      ['No memory of context', 'Smart buffers, protected hours, relationship memory'],
      ['Nothing beyond a confirmation email', 'Briefs, instructions, correspondence, minutes'],
      ['Nowhere safe to keep anything', 'An encrypted vault with a custody trail — the part nobody else has'],
      ['Not built for how Africa actually works', 'WhatsApp-native, offline-aware, Nigerian-English'],
    ], { fontSize: 11.5 });
  foot(s);
}

// ══════════════════════════════════════════════════════ 4 · WHAT IS BUILT
{
  const s = pres.addSlide();
  s.background = { color: NAVY };
  n += 1;
  s.addText('WHAT HAS CHANGED SINCE AUGUST', {
    x: M, y: 0.85, w: COL, h: 0.3,
    fontFace: 'Arial', fontSize: 11, bold: true, charSpacing: 2.2, color: GOLD,
    isTextBox: true, margin: 0,
  });
  s.addText('It is no longer a design. It is running software.', {
    x: M, y: 1.25, w: COL, h: 0.7,
    fontFace: 'Arial', fontSize: 34, bold: true, color: WHITE, isTextBox: true, margin: 0,
  });
  s.addText(
    'The August deck offered a fully designed product and a plan to build it. That plan has been '
    + 'executed. Every screen below can be opened and used today.',
    {
      x: M, y: 2.05, w: 10.4, h: 0.6,
      fontFace: 'Arial', fontSize: 13.5, color: 'A9B4C4', lineSpacing: 19, isTextBox: true, margin: 0,
    },
  );

  const stats = [
    ['39', 'features live', 'each carrying its own in-app guidance'],
    ['121', 'automated test suites', 'about 3,400 assertions, run on every release'],
    ['2', 'database backends', 'every suite green on SQLite and on Postgres'],
    ['74', 'tables in production', 'schema deployed, upgrading in place'],
  ];
  const cw = (COL - 0.75) / 4;
  stats.forEach(([big, label, sub], i) => {
    const x = M + i * (cw + 0.25);
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 3.05, w: cw, h: 2.35, rectRadius: 0.06,
      fill: { color: '13253D' }, line: { color: '1E3A5C', width: 0.75 },
    });
    s.addText(big, {
      x: x + 0.3, y: 3.25, w: cw - 0.6, h: 0.95,
      fontFace: 'Arial', fontSize: 52, bold: true, color: GOLD, isTextBox: true, margin: 0,
    });
    s.addText(label, {
      x: x + 0.3, y: 4.25, w: cw - 0.6, h: 0.3,
      fontFace: 'Arial', fontSize: 13, bold: true, color: WHITE, isTextBox: true, margin: 0,
    });
    s.addText(sub, {
      x: x + 0.3, y: 4.58, w: cw - 0.6, h: 0.7,
      fontFace: 'Arial', fontSize: 10.5, color: '8A97AB', lineSpacing: 14, isTextBox: true, margin: 0,
    });
  });

  s.addText(
    'Roughly 55,000 lines of application code and 29,500 lines of tests. '
    + 'Deployed and serving on managed Postgres.',
    {
      x: M, y: 5.65, w: COL, h: 0.3,
      fontFace: 'Arial', fontSize: 11.5, italic: true, color: PALE, isTextBox: true, margin: 0,
    },
  );
  s.addText(`KAIROS · SEED   ${n} / ${TOTAL}`, {
    x: M, y: H - 0.52, w: COL, h: 0.3, align: 'right',
    fontFace: 'Arial', fontSize: 9, charSpacing: 1.2, color: '4A5568', isTextBox: true, margin: 0,
  });
  s.addNotes('If an investor asks for one thing to verify, it is this slide: '
    + 'the product can be demonstrated live in the meeting.');
}

// ═══════════════════════════════════════════════════════════ 5 · PRODUCT
{
  const s = pres.addSlide();
  const y = page(s, 'THE PRODUCT',
    'Five systems that work as one, not a feature bolted onto a calendar.',
    'Each of these is live. The concierge marketplace is the one thing still ahead of us, and it is '
    + 'mapped onto data the platform already holds.');

  const rows = [
    ['Scheduling', 'Availability by length, four-tier public booking, buffers, calendar, in-app video, '
      + 'negotiation between booker and office.'],
    ['The assistant’s desk', 'A workspace of their own: approval queue, briefs, instructions, '
      + 'correspondence, minutes, one desk across several principals.'],
    ['The day, and getting through it', 'Today as the day’s shape, itinerary, trips with private and '
      + 'office visibility, movements with driver cards, check-calls and a duress signal.'],
    ['Custody', 'An encrypted vault for identity details and the documents behind them, a second '
      + 'factor on every reveal, and a trail the principal reads.'],
    ['Intelligence that refuses', 'Drafting, catch-up and week-ahead reading — which never sends on '
      + 'anyone’s behalf and cannot reach the vault at all.'],
  ];
  let ry = y + 0.05;
  rows.forEach(([h1, body], i) => {
    marker(s, M, ry + 0.04, i + 1);
    s.addText(h1, {
      x: M + 0.55, y: ry, w: 3.1, h: 0.4,
      fontFace: 'Arial', fontSize: 14, bold: true, color: NAVY, isTextBox: true, margin: 0,
    });
    s.addText(body, {
      x: M + 3.75, y: ry - 0.02, w: COL - 3.75, h: 0.72,
      fontFace: 'Arial', fontSize: 11.5, color: SLATE, lineSpacing: 16, isTextBox: true, margin: 0,
    });
    ry += 0.86;
  });
  foot(s);
}

// ═══════════════════════════════════════════════════════════ 6 · CUSTODY
{
  const s = pres.addSlide();
  const y = page(s, 'THE MOAT WE ACTUALLY HAVE',
    'Custody is the part no scheduling tool has, and the part that is hard to copy.',
    'A principal’s passport, their visas, their children’s papers, the lease — these live in WhatsApp '
    + 'threads and an assistant’s laptop today. Kairos is where they go instead.');

  const left = [
    ['Structural, not a permission flag',
      'An assistant engaged for scheduling genuinely cannot see a passport number. It is absent from '
      + 'their screen, not greyed out on it.'],
    ['Every reveal costs something and is recorded',
      'Opening a detail or a document asks for the principal’s second factor and writes a line the '
      + 'principal reads in their own report.'],
    ['Sealed before it leaves the server',
      'Documents — PDF, photograph or Word — are encrypted in the application. The storage provider '
      + 'holds bytes it cannot read.'],
  ];
  const right = [
    ['The AI is refused, not trusted',
      'It reads from a named list of five tables. The vault is not on it, and it never sends on '
      + 'anybody’s behalf under any instruction.'],
    ['A personal trip is offline to the office',
      'The principal decides who knows where they are. A Chief of Staff who sees the whole office '
      + 'does not see that.'],
    ['A driver’s card names nobody',
      'A journey link that can be forwarded shows two places and a plate — never whose journey it is.'],
  ];
  const cw = (COL - 0.4) / 2;
  [left, right].forEach((colItems, c) => {
    const x = M + c * (cw + 0.4);
    colItems.forEach(([h1, body], i) => {
      const yy = y + i * 1.42;
      card(s, x, yy, cw, 1.24);
      s.addText(h1, {
        x: x + 0.3, y: yy + 0.16, w: cw - 0.6, h: 0.28,
        fontFace: 'Arial', fontSize: 12.5, bold: true, color: TEAL, isTextBox: true, margin: 0,
      });
      s.addText(body, {
        x: x + 0.3, y: yy + 0.48, w: cw - 0.6, h: 0.68,
        fontFace: 'Arial', fontSize: 10.5, color: SLATE, lineSpacing: 14.5, isTextBox: true, margin: 0,
      });
    });
  });
  foot(s);
  s.addNotes('This is the answer to "what stops Calendly adding tiers". '
    + 'They would have to become a custodian, and custody is a different business.');
}

// ══════════════════════════════════════════════════════════ 7 · HOW BUILT
{
  const s = pres.addSlide();
  const y = page(s, 'HOW IT IS BUILT',
    'Software that holds passports has to be built like it.',
    'The engineering discipline below is not decoration for this deck — it is the reason a family '
    + 'office can be asked to put its papers here.');

  const points = [
    ['Every release runs on both backends',
      '121 suites, twice — once on SQLite and once on Postgres. A statement one accepts and the other '
      + 'rejects never reaches production.'],
    ['Security rules are proved by breaking them',
      'Every access rule is verified by deliberately removing it and watching the test go red. A test '
      + 'that cannot fail is treated as no test at all.'],
    ['One rule, in one place',
      'Who may see what is decided once and read by the screen, the export and the search alike — '
      + 'so the copy that drifts cannot exist.'],
    ['Nothing pretends to work',
      'A feature waiting on a credential says so by name, and lights itself the moment the credential '
      + 'is set. There are no dead buttons.'],
  ];
  const cw = (COL - 0.4) / 2;
  points.forEach(([h1, body], i) => {
    const x = M + (i % 2) * (cw + 0.4);
    const yy = y + Math.floor(i / 2) * 1.62;
    card(s, x, yy, cw, 1.4);
    marker(s, x + 0.3, yy + 0.24, i + 1);
    s.addText(h1, {
      x: x + 0.78, y: yy + 0.22, w: cw - 1.1, h: 0.34,
      fontFace: 'Arial', fontSize: 13.5, bold: true, color: NAVY, isTextBox: true, margin: 0,
    });
    s.addText(body, {
      x: x + 0.78, y: yy + 0.6, w: cw - 1.1, h: 0.72,
      fontFace: 'Arial', fontSize: 11, color: SLATE, lineSpacing: 15, isTextBox: true, margin: 0,
    });
  });
  foot(s);
}

// ════════════════════════════════════════════════════════════ 8 · MARKET
{
  const s = pres.addSlide();
  const y = page(s, 'THE MARKET',
    'A small share of a very large number.',
    'Kairos does not need mass adoption. It needs a sliver of Nigeria’s professional and high-net-worth '
    + 'population — reachable through one specific channel.');

  const stats = [
    ['242M', 'Nigerians', 'young, urbanising, mobile-first'],
    ['~15–18M', 'earn above ₦200K a month', 'the realistic income pool'],
    ['<0.1%', 'of that pool', 'is all the Year 3 plan requires'],
  ];
  const cw = (COL - 0.6) / 3;
  stats.forEach(([big, label, sub], i) => {
    const x = M + i * (cw + 0.3);
    card(s, x, y + 0.2, cw, 2.5, i === 2 ? '0F3B3B' : PAPER);
    const on = i === 2;
    s.addText(big, {
      x: x + 0.35, y: y + 0.5, w: cw - 0.7, h: 1.0,
      fontFace: 'Arial', fontSize: 46, bold: true, color: on ? GOLD : NAVY,
      isTextBox: true, margin: 0,
    });
    s.addText(label, {
      x: x + 0.35, y: y + 1.55, w: cw - 0.7, h: 0.34,
      fontFace: 'Arial', fontSize: 14, bold: true, color: on ? WHITE : NAVY,
      isTextBox: true, margin: 0,
    });
    s.addText(sub, {
      x: x + 0.35, y: y + 1.95, w: cw - 0.7, h: 0.5,
      fontFace: 'Arial', fontSize: 11.5, color: on ? 'A9C4C4' : MUTED,
      lineSpacing: 15, isTextBox: true, margin: 0,
    });
  });
  s.addText(
    'And the buyer we are built for is the one nobody else serves: the principal with an assistant, '
    + 'papers to keep, and a driver to send.',
    {
      x: M, y: y + 3.0, w: COL, h: 0.4,
      fontFace: 'Arial', fontSize: 12.5, italic: true, color: MUTED, isTextBox: true, margin: 0,
    },
  );
  foot(s);
}

// ════════════════════════════════════════════════════════════ 9 · GTM
{
  const s = pres.addSlide();
  const y = page(s, 'GO-TO-MARKET',
    'Founder-led relationships first, validated before we scale spend.',
    'Spend is weighted deliberately toward Executive and Family Office buyers rather than Standard-tier '
    + 'volume — the founder’s own network is the channel most likely to reach them directly.');

  const rows = [
    ['Now', 'Discovery sprint',
      '30–50 structured conversations with principals, assistants and pastors — resonance, '
      + 'willingness to pay, early-access interest.'],
    ['Now', 'Pilot on the live product',
      'Testers use the built product with every tier unlocked, so what we learn is about the work '
      + 'rather than about a paywall.'],
    ['Next', 'Design partners',
      'Three to five offices — one family office, two executives, two churches — run their real week '
      + 'on Kairos in exchange for shaping it.'],
    ['Then', 'Community networks',
      'Church and professional-association admin groups, entered only once the founder-led channel '
      + 'has produced retention data.'],
  ];
  table(s, M, y + 0.1, COL,
    [{ label: 'When', w: 1.3 }, { label: 'Motion', w: 3.0 }, { label: 'What it is', w: COL - 4.3 }],
    rows, { fontSize: 11.5 });
  foot(s);
}

// ══════════════════════════════════════════════════════════ 10 · MODEL
{
  const s = pres.addSlide();
  const y = page(s, 'BUSINESS MODEL',
    'Six tiers. Recurring revenue. FX risk managed explicitly.',
    'Mass-market tiers stay Naira-fixed. Family Office and Enterprise are USD-indexed, which is '
    + 'standard for Nigerian institutional contracts at this level.');

  table(s, M, y + 0.05, 8.4,
    [{ label: 'Tier', w: 2.6 }, { label: 'Price / month', w: 2.4, align: 'right' },
      { label: 'FX treatment', w: 3.4 }],
    [
      ['Free', '₦0', '—'],
      ['Standard', '₦8,000', 'Naira-fixed, annual review'],
      ['Plus', '₦15,000', 'Naira-fixed, annual review'],
      ['Executive', '₦25,000', 'Naira-fixed, annual review'],
      ['Family Office', '₦120,000', 'USD-indexed billing'],
      ['Enterprise', 'Custom', 'USD-indexed billing'],
    ], { fontSize: 11.5 });

  const x = M + 8.8;
  card(s, x, y + 0.05, COL - 8.8, 3.3, '13253D');
  s.addText('Said plainly', {
    x: x + 0.32, y: y + 0.3, w: COL - 9.44, h: 0.3,
    fontFace: 'Arial', fontSize: 12, bold: true, color: GOLD, isTextBox: true, margin: 0,
  });
  s.addText(
    'Billing is not built yet, and tier enforcement is switched off on purpose. Pilot testers reach '
    + 'every feature, because a tester stopped by a paywall on the thing you asked them to test is a '
    + 'finding that never arrives.\n\n'
    + 'The gate and the meter are written and inert. Turning them on is a decision, not a build.',
    {
      x: x + 0.32, y: y + 0.7, w: COL - 9.44, h: 2.5,
      fontFace: 'Arial', fontSize: 11, color: 'C7CFDB', lineSpacing: 15.5, isTextBox: true, margin: 0,
    },
  );
  foot(s);
}

// ═══════════════════════════════════════════════════════ 11 · WHERE WE ARE
{
  const s = pres.addSlide();
  const y = page(s, 'WHERE WE ARE TODAY',
    'Product risk is behind us. Market risk is in front of us.',
    'This is the whole of the honest position, with nothing rounded up.');

  const done = [
    'The product is built, tested and deployed.',
    'Custody, scheduling, the assistant’s desk and movements all work end to end.',
    'A pilot is open, with every tier unlocked for testers.',
    'Discovery interviews are underway across Lagos and Abuja.',
  ];
  const notYet = [
    'No paying customers. Billing is not built.',
    'No retention data yet — nobody has been on it 90 days.',
    'Eight of twenty-three named plan features are on the ladder but not yet wired.',
    'Community-network access is assumed, not validated.',
  ];
  const cw = (COL - 0.4) / 2;
  [['DONE', done, TEAL], ['NOT YET', notYet, '8A3B2F']].forEach(([label, items, colour], c) => {
    const x = M + c * (cw + 0.4);
    card(s, x, y, cw, 3.1);
    s.addText(label, {
      x: x + 0.35, y: y + 0.25, w: cw - 0.7, h: 0.3,
      fontFace: 'Arial', fontSize: 11, bold: true, charSpacing: 1.6, color: colour,
      isTextBox: true, margin: 0,
    });
    s.addText(items.map((t, i) => ({
      text: t, options: { bullet: true, breakLine: i !== items.length - 1 },
    })), {
      x: x + 0.35, y: y + 0.65, w: cw - 0.7, h: 2.2,
      fontFace: 'Arial', fontSize: 12, color: SLATE, lineSpacing: 17, paraSpaceAfter: 8,
      isTextBox: true, margin: 0,
    });
  });
  s.addText(
    'We are not asking you to believe the product can be built. We are asking you to fund finding out '
    + 'what people will pay for it.',
    {
      x: M, y: y + 3.35, w: COL, h: 0.4,
      fontFace: 'Arial', fontSize: 13, bold: true, italic: true, color: NAVY,
      isTextBox: true, margin: 0,
    },
  );
  foot(s);
}

// ═══════════════════════════════════════════════════ 12 · THE ARITHMETIC
{
  const s = pres.addSlide();
  const y = page(s, 'THE MODEL — ASSUMPTIONS, NOT RESULTS',
    'The arithmetic behind the milestone, and what discovery must replace.',
    'Every figure on this slide is an assumption derived from the plan. None of it is measured. '
    + 'It is here so you can argue with the numbers rather than guess at them.');

  table(s, M, y, 7.4,
    [{ label: 'Milestone mix at Month 20', w: 3.0 }, { label: 'Subs', w: 1.1, align: 'right' },
      { label: '₦/month', w: 1.6, align: 'right' }, { label: 'Monthly', w: 1.7, align: 'right' }],
    [
      ['Standard', '330', '8,000', '₦2.64M'],
      ['Plus', '110', '15,000', '₦1.65M'],
      ['Executive', '45', '25,000', '₦1.13M'],
      ['Family Office', '15', '120,000', '₦1.80M'],
      ['Total', '500', '—', '₦7.22M'],
    ], { fontSize: 11, boldLast: true });

  const x = M + 7.8;
  const derived = [
    ['₦86M', 'annualised recurring revenue at the milestone'],
    ['₦84,000', 'implied cost per paying subscriber (₦42M GTM ÷ 500)'],
    ['5.8 months', 'payback on blended ARPU of ₦14,430'],
    ['4.1 : 1', 'LTV to CAC, assuming 24-month average tenure'],
  ];
  derived.forEach(([big, label], i) => {
    const yy = y + i * 0.82;
    s.addText(big, {
      x, y: yy, w: 2.0, h: 0.38,
      fontFace: 'Arial', fontSize: 19, bold: true, color: TEAL, isTextBox: true, margin: 0,
    });
    s.addText(label, {
      x: x + 2.1, y: yy + 0.04, w: COL - 7.8 - 2.1, h: 0.6,
      fontFace: 'Arial', fontSize: 11, color: SLATE, lineSpacing: 15, isTextBox: true, margin: 0,
    });
  });

  s.addText(
    'What discovery replaces: the tenure assumption behind LTV, the tier mix, and the channel cost — '
    + 'in that order of importance.',
    {
      x: M, y: y + 3.5, w: COL, h: 0.4,
      fontFace: 'Arial', fontSize: 11.5, italic: true, color: MUTED, isTextBox: true, margin: 0,
    },
  );
  foot(s);
}

// ═══════════════════════════════════════════════════════ 13 · DEFENSIBILITY
{
  const s = pres.addSlide();
  const y = page(s, 'DEFENSIBILITY',
    'What we can claim today, and what we still have to prove.',
    null);

  const rows = [
    ['Real today', 'Custody is a different product',
      'A competitor adding tiers to a booking page has not become a custodian. Encryption, step-up, '
      + 'a custody trail and structural access control are a year of work and a different risk appetite.'],
    ['Real today', 'The assistant is the wedge',
      'The person who would have to migrate is the assistant, and they hold the relationship memory. '
      + 'That is a harder person to move than a principal.'],
    ['Being tested', 'Switching costs accumulate',
      'Relationship memory and embedded workflow should raise the cost of leaving the longer a pair '
      + 'uses it. Tracked by cohort tenure from the first retention milestone.'],
    ['Not claimed', 'Network effects',
      'There are none yet and we do not assert any. Bookers do not bring bookers at this stage.'],
  ];
  table(s, M, y + 0.1, COL,
    [{ label: 'Status', w: 1.7 }, { label: 'Mechanism', w: 3.3 }, { label: 'The argument', w: COL - 5.0 }],
    rows, { fontSize: 11 });
  foot(s);
}

// ══════════════════════════════════════════════════════════ 14 · TEAM
{
  const s = pres.addSlide();
  const y = page(s, 'THE TEAM',
    'Domain expertise, and execution that is now on the record.',
    null);

  const people = [
    ['Bassileou Ayomikun Crown', 'Founder',
      'Founder of Exousia Prime Emporium Ltd. A pastor who leads and coordinates large teams and '
      + 'complex operations every week — living the exact problem Kairos solves. Designed the whole '
      + 'product and directed its build.'],
    ['Glory Ugwu', 'Technical Co-Founder & CTO',
      'Around three years building production software at Medallion (Sequoia Capital and Google '
      + 'Ventures-backed). Authentication and authorisation systems, webhook integrations and public '
      + 'API work — directly the shape of Kairos’s permissions and WhatsApp layers.'],
  ];
  const cw = (COL - 0.4) / 2;
  people.forEach(([name, role, body], i) => {
    const x = M + i * (cw + 0.4);
    card(s, x, y, cw, 2.7);
    s.addText(name, {
      x: x + 0.4, y: y + 0.32, w: cw - 0.8, h: 0.34,
      fontFace: 'Arial', fontSize: 17, bold: true, color: NAVY, isTextBox: true, margin: 0,
    });
    s.addText(role, {
      x: x + 0.4, y: y + 0.72, w: cw - 0.8, h: 0.28,
      fontFace: 'Arial', fontSize: 11, bold: true, charSpacing: 1.2, color: GOLD,
      isTextBox: true, margin: 0,
    });
    s.addText(body, {
      x: x + 0.4, y: y + 1.12, w: cw - 0.8, h: 1.4,
      fontFace: 'Arial', fontSize: 11.5, color: SLATE, lineSpacing: 16, isTextBox: true, margin: 0,
    });
  });
  s.addText(
    'Hiring against this round: a second engineer at Month 3, a go-to-market lead at Month 4, '
    + 'a third engineer and a customer-success lead at Month 9.',
    {
      x: M, y: y + 2.95, w: COL, h: 0.4,
      fontFace: 'Arial', fontSize: 12, color: MUTED, isTextBox: true, margin: 0,
    },
  );
  foot(s);
}

// ═══════════════════════════════════════════════════════════ 15 · THE ASK
{
  const s = pres.addSlide();
  s.background = { color: NAVY };
  n += 1;
  s.addText('THE ASK', {
    x: M, y: 0.85, w: COL, h: 0.3,
    fontFace: 'Arial', fontSize: 11, bold: true, charSpacing: 2.2, color: GOLD,
    isTextBox: true, margin: 0,
  });
  s.addText('₦350M, structured in two tranches.', {
    x: M, y: 1.25, w: COL, h: 0.7,
    fontFace: 'Arial', fontSize: 34, bold: true, color: WHITE, isTextBox: true, margin: 0,
  });
  s.addText(
    'Indicatively about US$230,000 at ₦1,500 to the dollar. Built up from the team, the timeline and '
    + 'the risk buffer the plan actually needs — not reverse-engineered from a target cheque.',
    {
      x: M, y: 2.05, w: 10.6, h: 0.7,
      fontFace: 'Arial', fontSize: 13, color: 'A9B4C4', lineSpacing: 19, isTextBox: true, margin: 0,
    },
  );

  const parts = [
    ['₦250M', 'Tranche 1', 'The 24-month operating plan'],
    ['₦100M', 'Tranche 2', 'Triggered reserve, deployed on conditions'],
    ['₦350M', 'Total', 'Bottom-up from the milestone'],
  ];
  const cw = (COL - 0.6) / 3;
  parts.forEach(([big, label, sub], i) => {
    const x = M + i * (cw + 0.3);
    const on = i === 2;
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 3.0, w: cw, h: 2.0, rectRadius: 0.06,
      fill: { color: on ? GOLD : '13253D' },
      line: { color: on ? GOLD : '1E3A5C', width: 0.75 },
    });
    s.addText(big, {
      x: x + 0.35, y: 3.22, w: cw - 0.7, h: 0.85,
      fontFace: 'Arial', fontSize: 42, bold: true, color: on ? NAVY : WHITE,
      isTextBox: true, margin: 0,
    });
    s.addText(label, {
      x: x + 0.35, y: 4.1, w: cw - 0.7, h: 0.3,
      fontFace: 'Arial', fontSize: 13, bold: true, color: on ? NAVY : GOLD,
      isTextBox: true, margin: 0,
    });
    s.addText(sub, {
      x: x + 0.35, y: 4.44, w: cw - 0.7, h: 0.45,
      fontFace: 'Arial', fontSize: 10.5, color: on ? '4A3B18' : '8A97AB',
      lineSpacing: 14, isTextBox: true, margin: 0,
    });
  });

  s.addText(
    'Why more than the August plan: that plan costed five people for 24 months at ₦34.7M — about '
    + '₦1.4M a month for the whole team, which one senior Lagos engineer costs on their own. '
    + 'The line that decides whether the thing gets built was the line that was short.',
    {
      x: M, y: 5.3, w: COL, h: 0.8,
      fontFace: 'Arial', fontSize: 11.5, color: PALE, lineSpacing: 16, isTextBox: true, margin: 0,
    },
  );
  s.addText(`KAIROS · SEED   ${n} / ${TOTAL}`, {
    x: M, y: H - 0.52, w: COL, h: 0.3, align: 'right',
    fontFace: 'Arial', fontSize: 9, charSpacing: 1.2, color: '4A5568', isTextBox: true, margin: 0,
  });
  s.addNotes('The raise is 2.2x the August number. The justification is on the slide: '
    + 'the old team line was not payable at Lagos market rates.');
}

// ══════════════════════════════════════════════════════════ 16 · USE T1
{
  const s = pres.addSlide();
  const y = page(s, 'USE OF FUNDS — TRANCHE 1',
    '₦250M, the 24-month operating plan.',
    'The product is built, so this money buys distribution, proof and the people to hold both — '
    + 'not a first build.');

  table(s, M, y + 0.05, COL,
    [{ label: 'Category', w: 2.6 }, { label: 'Amount', w: 1.5, align: 'right' },
      { label: 'What it buys', w: COL - 4.1 }],
    [
      ['Team', '₦150M',
        'Founder and CTO for 24 months; second engineer from Month 3; GTM lead from Month 4; '
        + 'third engineer and customer-success lead from Month 9 — at Lagos market rates'],
      ['Go-to-market', '₦42M',
        'Founder-led outreach, a paid design-partner programme, and acquisition weighted to '
        + 'Executive and Family Office buyers'],
      ['Infrastructure & security', '₦20M',
        'Managed Postgres, encrypted object storage, WhatsApp Business API, transcription and AI '
        + 'inference — plus an independent security audit of the custody layer'],
      ['Legal, compliance & ops', '₦15M',
        'NDPA registration and a data-protection impact assessment for custody data, contracts, '
        + 'company operations'],
      ['Contingency (10%)', '₦23M',
        'Naira devaluation and hiring slippage, held against the Naira-fixed tiers'],
      ['Total, Tranche 1', '₦250M', ''],
    ], { fontSize: 10.5, boldLast: true });
  foot(s);
}

// ══════════════════════════════════════════════════════════ 17 · USE T2
{
  const s = pres.addSlide();
  const y = page(s, 'USE OF FUNDS — TRANCHE 2',
    '₦100M triggered reserve — conditions, not idle capital.',
    'None of this is drawn unless its trigger fires, and each trigger is a number we agree with you '
    + 'before the round closes.');

  table(s, M, y + 0.1, COL,
    [{ label: 'Reserve', w: 3.4 }, { label: 'Amount', w: 1.5, align: 'right' },
      { label: 'Deployment trigger', w: COL - 4.9 }],
    [
      ['Fundraising-gap protection', '₦45M',
        'Drawn only if the seed process extends past Month 20'],
      ['FX shock absorption', '₦30M',
        'Drawn only if NGN/USD moves beyond the threshold agreed at closing'],
      ['Second-market accelerant', '₦25M',
        'Drawn only if the Tranche 1 milestone is reached ahead of schedule — Accra and Nairobi'],
      ['Total, Tranche 2', '₦100M', ''],
    ], { fontSize: 11, boldLast: true });

  s.addText(
    'A tranche that is never drawn is a tranche you keep. The structure exists so a Naira shock or a '
    + 'slow seed market does not become a down round.',
    {
      x: M, y: y + 2.9, w: COL, h: 0.4,
      fontFace: 'Arial', fontSize: 12, italic: true, color: MUTED, isTextBox: true, margin: 0,
    },
  );
  foot(s);
}

// ════════════════════════════════════════════════════════ 18 · TIMELINE
{
  const s = pres.addSlide();
  const y = page(s, 'WHAT THE MONEY BUYS, IN ORDER',
    'Milestones tied to capital, not to the calendar alone.',
    null);

  table(s, M, y + 0.1, COL,
    [{ label: 'Window', w: 1.9 }, { label: 'Milestone', w: COL - 4.3 },
      { label: 'Tranche', w: 2.4 }],
    [
      ['Month 0–2', 'Billing built and switched on; design partners signed; discovery results '
        + 'folded into pricing', 'T1 deploying'],
      ['Month 3–8', 'Second engineer and GTM lead in seat; the eight unwired features decided — '
        + 'wired or struck', 'T1 deploying'],
      ['Month 9–14', 'Third engineer and customer success; first cohort past 90 days; retention '
        + 'measured by tenure', 'T1 deploying'],
      ['Month 15–20', '500 paying subscribers, ₦86M annualised, retention proved — seed-ready',
        'T2c if early'],
      ['Month 20–24', 'Seed process runs', 'T2a if it extends'],
      ['Throughout', 'NGN/USD monitored against the agreed threshold', 'T2b if it breaches'],
    ], { fontSize: 10.5 });
  foot(s);
}

// ═══════════════════════════════════════════════════════════ 19 · RISKS
{
  const s = pres.addSlide();
  const y = page(s, 'HONEST RISKS',
    'We would rather you heard these from us.',
    null);

  const rows = [
    ['No revenue has ever been collected',
      'Billing is the first thing Tranche 1 builds, in Month 0–2, before any other spend commits.'],
    ['Willingness to pay is unproven',
      'The discovery sprint and a paid design-partner programme test price before acquisition spend scales.'],
    ['Adoption may be slower than planned',
      'Tranche 2a covers a fundraising-timeline gap without a bridge or a down round.'],
    ['Churn on the lower tiers',
      'Relationship memory should raise switching costs; measured directly by cohort tenure rather than assumed.'],
    ['Naira/USD volatility',
      'Two-tier FX treatment, a 10% contingency, and Tranche 2b behind an agreed threshold.'],
    ['Key-person concentration',
      'The founder is the channel today. The GTM lead at Month 4 exists specifically to reduce that.'],
    ['Founders’ equity not yet formalised',
      'In progress in parallel; to be completed before any term sheet is signed.'],
  ];
  const cw = (COL - 0.4) / 2;
  rows.forEach(([h1, body], i) => {
    const x = M + (i % 2) * (cw + 0.4);
    const yy = y + Math.floor(i / 2) * 1.02;
    s.addText(h1, {
      x, y: yy, w: cw, h: 0.3,
      fontFace: 'Arial', fontSize: 12.5, bold: true, color: NAVY, isTextBox: true, margin: 0,
    });
    s.addText(body, {
      x, y: yy + 0.31, w: cw, h: 0.62,
      fontFace: 'Arial', fontSize: 10.5, color: SLATE, lineSpacing: 14.5, isTextBox: true, margin: 0,
    });
  });
  foot(s);
}

// ═══════════════════════════════════════════════════════════ 20 · CLOSE
{
  const s = pres.addSlide();
  s.background = { color: NAVY };
  n += 1;
  s.addText('THE OPPORTUNITY', {
    x: M, y: 1.4, w: COL, h: 0.3,
    fontFace: 'Arial', fontSize: 11, bold: true, charSpacing: 2.2, color: GOLD,
    isTextBox: true, margin: 0,
  });
  s.addText('The build risk is spent. Fund the proof.', {
    x: M, y: 1.85, w: 10.5, h: 1.2,
    fontFace: 'Arial', fontSize: 40, bold: true, color: WHITE, lineSpacing: 46,
    isTextBox: true, margin: 0,
  });
  s.addText(
    '₦350M to reach 500 paying, retained subscribers and ₦86M annualised — the milestone that turns '
    + 'a working product into a proven business, and Kairos into the place Africa’s most valuable '
    + 'time and papers are kept.',
    {
      x: M, y: 3.2, w: 9.8, h: 1.1,
      fontFace: 'Arial', fontSize: 15, color: 'C7CFDB', lineSpacing: 24, isTextBox: true, margin: 0,
    },
  );
  s.addText('Bassileou Ayomikun Crown · Founder, Exousia Prime Emporium Ltd', {
    x: M, y: 5.15, w: COL, h: 0.32,
    fontFace: 'Arial', fontSize: 14, bold: true, color: WHITE, isTextBox: true, margin: 0,
  });
  s.addText('+234 814 160 9122   ·   bassileoucrown@gmail.com', {
    x: M, y: 5.55, w: COL, h: 0.32,
    fontFace: 'Arial', fontSize: 12.5, color: PALE, isTextBox: true, margin: 0,
  });
  s.addText('Live product walkthrough and the full financial model available on request.', {
    x: M, y: 5.95, w: COL, h: 0.32,
    fontFace: 'Arial', fontSize: 11.5, italic: true, color: '6E7B8F', isTextBox: true, margin: 0,
  });
  s.addText(`KAIROS · SEED   ${n} / ${TOTAL}`, {
    x: M, y: H - 0.52, w: COL, h: 0.3, align: 'right',
    fontFace: 'Arial', fontSize: 9, charSpacing: 1.2, color: '4A5568', isTextBox: true, margin: 0,
  });
}

pres.writeFile({ fileName: 'Kairos_Investor_Deck_Sept2026.pptx' })
  .then((f) => console.log(`wrote ${f} — ${n} slides`));
