// Turn the four documents into PDFs, and keep their print styling in one place.
//
// The HTML is the source. A PDF is what you attach to an email, hand to
// somebody in a room with no signal, or read on a plane — so it is generated
// from the same file rather than maintained beside it, and regenerating is the
// only way it is ever updated.
//
//   node docs/makepdfs.js
//
// Chromium is already on this machine at /opt/pw-browsers/chromium.
const { chromium } = require('/home/user/Kairos/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const DOCS_DIR = __dirname;
const OUT_DIR = path.join(DOCS_DIR, 'pdf');

const DOCS = [
  ['investor-deck.html', 'Kairos — The Chain, Not the List.pdf', 120],
  ['teammate-deck.html', 'Kairos — Inside Kairos.pdf', null],
  ['founder-handbook.html', 'Kairos — Founder Handbook.pdf', null],
  ['developer-handover.html', 'Kairos — Developer Handover.pdf', null],
];

// Print styling, applied at generation time rather than committed into each
// document, because it is the same everywhere and four copies would drift.
//
// It forces the light palette outright. A PDF has no viewer preference to
// follow — it has ink and paper — and a dark page printed on white is both
// unreadable and rude to whoever owns the printer.
const PRINT_CSS = `
  :root, :root[data-theme="dark"] {
    --ground: #FFFFFF; --sheet: #FFFDF8; --ink: #191D22; --muted: #5C5749;
    --rule: #D8D2C4; --accent: #35564B; --warn: #7A5D1F; --stop: #94382E;
    --accent-wash: rgba(53, 86, 75, 0.08);
    --warn-wash: rgba(122, 93, 31, 0.10);
    --stop-wash: rgba(148, 56, 46, 0.09);
    --code-bg: rgba(25, 29, 34, 0.05);
    --shadow: none;
  }
  body { background: #FFFFFF; color: #191D22; padding: 0; font-size: 10.5pt; }
  .wrap { max-width: none; }

  /* A sticky rail in a paged medium pins itself to the top of every page. */
  .rail { position: static; }

  /* Keep a heading with what it introduces, and never split a figure. */
  h1, h2, h3, h4 { break-after: avoid-page; }
  .card, .why, .stopblock, .verdict, .stat, .rules li, tr, .row { break-inside: avoid; }
  .leaf { break-inside: auto; padding: 20pt 0; }
  .title-leaf { break-after: page; padding: 0 0 24pt; }
  .end { break-before: avoid-page; }

  /* Nothing scrolls on paper — let wide things be as wide as they are. */
  .tablewrap, pre { overflow: visible; }

  /* The slider is frozen at one value in the PDF; say so rather than
     printing a control nobody can move. */
  .slider-row input[type=range] { display: none; }
  .ticks { display: none; }
  .slider-row::after {
    content: "— frozen for print. The published page is interactive.";
    font-family: var(--machine); font-size: 8.5pt; color: var(--muted);
  }
`;

function wrapped(file) {
  const body = fs.readFileSync(path.join(DOCS_DIR, file), 'utf8');
  const out = path.join('/tmp', 'print-' + file);
  fs.writeFileSync(out, `<!doctype html><html data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style>
</head><body>${body}<style>@media print {${PRINT_CSS}}</style></body></html>`);
  return out;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const [file, out, freezeAt] of DOCS) {
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('file://' + wrapped(file));

    // Print the investor deck's demo in its most useful state: the one where
    // the anchor refuses. A slider frozen at zero teaches nothing.
    if (freezeAt !== null) {
      await page.evaluate((v) => {
        const s = document.getElementById('delay');
        if (!s) return;
        s.value = String(v);
        s.dispatchEvent(new Event('input', { bubbles: true }));
      }, freezeAt);
      await page.waitForTimeout(150);
    }

    const target = path.join(OUT_DIR, out);
    await page.pdf({
      path: target,
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font:8pt ui-monospace,Menlo,monospace;
        color:#8A857A;padding:0 16mm;display:flex;justify-content:space-between;">
        <span>Kairos by Exousia</span><span class="pageNumber"></span></div>`,
    });

    const kb = Math.round(fs.statSync(target).size / 1024);
    console.log(`${errors.length ? '✗' : '✓'} ${out}  ${kb} KB`
      + (errors.length ? `  — ${errors[0]}` : ''));
    await ctx.close();
  }

  await browser.close();
})();
