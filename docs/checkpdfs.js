// Look at the PDFs, rather than at the files.
//
// The first version of this check ran `strings` over them and grepped. That
// proved nothing: Chromium writes text into FlateDecode streams as subsetted
// glyph ids, so a word that is plainly on the page appears nowhere in the raw
// bytes — and a search for it comes back clean whether it is there or not. A
// check that cannot fail is worse than no check, because it gets quoted.
//
// So this opens each PDF in Chromium's own viewer and reads what a person
// would see: the page count, and a screenshot of the pages most likely to be
// wrong — the first, the last, and any named in FOCUS below.
//
//   node docs/checkpdfs.js            # page counts, and a warning if stale
//   node docs/checkpdfs.js --shots    # also write PNGs to /tmp/pdfshots
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const PDF_DIR = path.join(__dirname, 'pdf');
const SHOT_DIR = '/tmp/pdfshots';
const SHOTS = process.argv.includes('--shots');

// Which source file each PDF is built from, so a stale PDF is caught by date
// rather than by somebody noticing a paragraph is missing.
const SOURCES = {
  'Kairos — The Chain, Not the List.pdf': 'investor-deck.html',
  'Kairos — Inside Kairos.pdf': 'teammate-deck.html',
  'Kairos — Founder Handbook.pdf': 'founder-handbook.html',
  'Kairos — Developer Handover.pdf': 'developer-handover.html',
};

// Pages worth looking at beyond the first and the last: the ones carrying a
// figure that a page break could cut in half.
const FOCUS = {
  'Kairos — The Chain, Not the List.pdf': [2, 3],
  'Kairos — Inside Kairos.pdf': [2, 3],
  'Kairos — Developer Handover.pdf': [11],
};

let problems = 0;
const bad = (m) => { problems++; console.log('  ✗ ' + m); };
const good = (m) => console.log('  ✓ ' + m);

(async () => {
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  });

  for (const [file, source] of Object.entries(SOURCES)) {
    console.log('\n' + file);
    const pdfPath = path.join(PDF_DIR, file);
    const srcPath = path.join(__dirname, source);

    if (!fs.existsSync(pdfPath)) { bad('missing entirely'); continue; }

    // Freshness first — a beautiful PDF of last week's text is still wrong.
    const pdfAt = fs.statSync(pdfPath).mtimeMs;
    const srcAt = fs.statSync(srcPath).mtimeMs;
    if (srcAt > pdfAt) {
      bad(`older than ${source} — regenerate with node docs/makepdfs.js`);
    } else {
      good(`newer than ${source}`);
    }

    const page = await browser.newPage({ viewport: { width: 1000, height: 1300 } });
    await page.goto('file://' + encodeURI(pdfPath).replace(/#/g, '%23'));
    await page.waitForTimeout(2500);

    // Page count from the file's own structure rather than from the viewer's
    // toolbar. The toolbar lives behind a shadow root whose internals are
    // Chromium's business and change without notice; `/Type /Page` objects are
    // the format itself, and are not going anywhere.
    const bytes = fs.readFileSync(pdfPath).toString('latin1');
    const count = (bytes.match(/\/Type\s*\/Page(?![s])/g) || []).length;

    if (count > 0) good(`${count} pages`);
    else bad('no page objects found — the file is not a readable PDF');

    if (SHOTS) {
      // Neither a #page=N fragment nor PageDown moves this viewer — the
      // fragment is ignored and the key goes to the document rather than the
      // embedded plugin. Both left every screenshot sitting on page one,
      // looking for all the world like proof that the pages were fine.
      // The wheel, over the viewer, is what a reader actually does.
      const PAGE_PX = 955;  // A4 at the viewer's default zoom in a 1000px pane
      const wanted = [...new Set([1, ...(FOCUS[file] || []), count])]
        .filter((n) => n >= 1 && n <= count)
        .sort((a, b) => a - b);
      await page.mouse.move(650, 700);
      let scrolled = 0;
      for (const n of wanted) {
        const target = (n - 1) * PAGE_PX;
        while (scrolled < target) {
          const step = Math.min(1200, target - scrolled);
          await page.mouse.wheel(0, step);
          scrolled += step;
          await page.waitForTimeout(120);
        }
        await page.waitForTimeout(600);
        const out = path.join(SHOT_DIR, `${source.replace('.html', '')}-p${n}.png`);
        await page.screenshot({ path: out });
        console.log('    → ' + out);
      }
    }

    await page.close();
  }

  await browser.close();
  console.log(problems ? `\n${problems} PROBLEMS` : '\nAll four PDFs are current and readable.');
  process.exit(problems ? 1 : 0);
})();
