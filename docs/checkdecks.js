// Verify the four documents render: both themes, desktop and mobile,
// no console errors, no horizontal overflow, and the cascade demo's arc.
const { chromium } = require('/home/user/Kairos/node_modules/playwright-core');
const path = require('path');

const SC = __dirname;  // the four documents live beside this file
const DOCS = [
  ['investor', 'investor-deck.html'],
  ['team', 'teammate-deck.html'],
  ['handbook', 'founder-handbook.html'],
  ['dev', 'developer-handover.html'],
];

// The published page wraps the file in a doctype/head/body skeleton, so do
// the same here rather than testing something the reader never sees.
const fs = require('fs');
function wrap(file) {
  const body = fs.readFileSync(path.join(SC, file), 'utf8');
  const out = path.join('/tmp', 'wrapped-' + file);
  fs.writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style>
</head><body>${body}</body></html>`);
  return out;
}

let fails = 0;
const ok = (l, c, extra = '') => {
  if (!c) { fails++; console.log('  ✗ ' + l + (extra ? ' — ' + extra : '')); }
  else console.log('  ✓ ' + l);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  for (const [name, file] of DOCS) {
    console.log('\n' + name);
    const url = 'file://' + wrap(file);

    for (const scheme of ['light', 'dark']) {
      for (const [w, h, label] of [[1280, 900, 'desktop'], [390, 844, 'mobile']]) {
        const ctx = await browser.newContext({
          colorScheme: scheme,
          viewport: { width: w, height: h },
        });
        const page = await ctx.newPage();
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(url);
        await page.waitForTimeout(250);

        const m = await page.evaluate(() => {
          const de = document.documentElement;
          const cs = getComputedStyle(document.body);
          return {
            overflow: de.scrollWidth - de.clientWidth,
            bg: cs.backgroundColor,
            fg: cs.color,
            leaves: document.querySelectorAll('.leaf').length,
          };
        });

        const tag = `${scheme}/${label}`;
        ok(`${tag} · no console errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
        ok(`${tag} · no horizontal overflow`, m.overflow <= 1, `${m.overflow}px`);
        ok(`${tag} · body paints a background`,
          m.bg !== 'rgba(0, 0, 0, 0)' && m.bg !== 'transparent', m.bg);
        ok(`${tag} · ink differs from ground`, m.bg !== m.fg, `${m.bg} / ${m.fg}`);
        ok(`${tag} · leaves rendered`, m.leaves >= 5, String(m.leaves));

        // Dark really is dark, light really is light — catches a palette that
        // only ever defines one theme.
        const lum = (c) => {
          const p = c.match(/\d+/g).map(Number);
          return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
        };
        ok(`${tag} · ground matches the scheme`,
          scheme === 'dark' ? lum(m.bg) < 80 : lum(m.bg) > 180, m.bg);

        await ctx.close();
      }
    }

    // The investor deck's demo has to teach both rules.
    if (name === 'investor') {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(url);
      const at = async (v) => {
        await page.evaluate((val) => {
          const s = document.getElementById('delay');
          s.value = String(val);
          s.dispatchEvent(new Event('input', { bubbles: true }));
        }, v);
        await page.waitForTimeout(60);
        return {
          verdict: await page.locator('#verdict').innerText(),
          shifted: await page.locator('.row.is-shift').count(),
          broken: await page.locator('.row.is-break').count(),
          read: await page.locator('#delayRead').innerText(),
        };
      };
      const a20 = await at(20), a45 = await at(45), a90 = await at(90), a120 = await at(120);
      console.log('  demo arc:', [a20, a45, a90, a120].map((x) => `${x.read} s${x.shifted} b${x.broken}`).join(' · '));
      ok('20 min moves almost nothing', a20.shifted === 1 && a20.broken === 0);
      ok('45 min is swallowed by a gap', a45.shifted === 1 && a45.broken === 0
        && /gap/i.test(a45.verdict));
      ok('90 min ripples and still makes the flight', a90.shifted === 3 && a90.broken === 0);
      ok('120 min breaks the flight', a120.broken === 1 && /after it leaves/i.test(a120.verdict));
      ok('and names who to tell', /to tell/i.test(a90.verdict), a90.verdict);
      await ctx.close();
    }
  }

  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nAll four documents render correctly in both themes.');
  process.exit(fails ? 1 : 0);
})();
