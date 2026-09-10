// Thirteen explainers: one main screen each, shown whole, said in detail.
//
// DIFFERENT FROM phones.js. That set says what Kairos feels like — a phone, a
// headline, one line. This set says what each screen actually does: the whole
// window with its rail, and underneath it the steps for using the thing. A
// person who reads one of these should be able to describe the screen to
// somebody else.
//
// THE WORDS COME FROM THE APP, NOT FROM ME. Every title, description, step and
// note below is read out of app/server/lib/guide.js — the same copy the "What
// this does" panel shows inside the product, on all 39 screens. Marketing that
// paraphrases the product drifts from it within a month; marketing that reads
// the product cannot. Change the guide and re-run this, and the posts follow.
//
// THE CAPTION IS NOT ON THE GRAPHIC, on instruction. The design carries the
// name of the screen, what it is, the picture and the steps. The post copy and
// the hashtags live in captions-wide.json and are written out beside each
// image by split.js.
//
// OVERFLOW FAILS THE RUN. The canvas is a fixed pixel size and the body clips,
// so a step too many is cropped silently and the image still looks finished.
// The layout is deliberately plain block flow rather than a flex column for
// exactly this reason: a flex column absorbs the overflow by squeezing
// something, and then the check has nothing to see. That mistake shipped
// fourteen blank posts earlier in this directory's history.

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core'));

const guide = require(path.join(__dirname, '..', '..', 'app', 'server', 'lib', 'guide.js'));

const SHOTS = path.resolve(process.argv[3] || path.join(__dirname, 'wide-shots'));
const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'explainers'));
const W = 1080, H = 1350;

// shot file, guide key, and the group it sits under in the rail — the kicker
// is the rail's own grouping, so somebody who has seen two of these already
// knows where in the app they are.
const POSTS = [
  ['today', 'today', 'The day'],
  ['catch-up', 'catch_up', 'The day'],
  ['itinerary', 'itinerary', 'The day'],
  ['pad', 'pad', 'The day'],
  ['trips', 'trips', 'The day'],
  ['desk', 'desk', 'The desk'],
  ['report', 'report', 'The desk'],
  ['correspondence', 'correspondence', 'The desk'],
  ['spaces', 'spaces', 'Work'],
  ['tasks', 'tasks', 'Work'],
  ['archive', 'archive', 'Work'],
  ['connections', 'connections', 'The house'],
  ['team', 'members', 'Account'],
];

const CSS = `
:root{
  --paper:#FAF9F6; --ink:#1C2127; --muted:#6B6659; --green:#3E6357;
  --deep:#24372F; --gold:#8A6A24; --border:#E3E0D6; --soft:#EEF2EF;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
/* Plain block flow, fixed height, clipped. See the header comment: a flex
   column here would swallow an overflow instead of letting it be measured. */
body{width:${W}px;height:${H}px;overflow:hidden;background:var(--paper);
  color:var(--ink);font-family:'Liberation Sans',Arial,Helvetica,sans-serif;
  padding:40px 64px 36px}

.brand{display:flex;align-items:baseline;gap:14px;margin-bottom:22px}
.brand .mk{font-family:'Bitstream Charter',Charter,Georgia,serif;
  font-size:28px;font-weight:700;letter-spacing:-0.3px}
.brand .mk i{font-style:normal;color:var(--gold)}
.brand .tag{margin-left:auto;font-size:12px;letter-spacing:2.6px;
  text-transform:uppercase;font-weight:700;color:var(--muted)}

.kicker{font-size:13px;font-weight:700;letter-spacing:3.4px;text-transform:uppercase;
  color:var(--gold);margin:0 0 10px}
h1{font-family:'Bitstream Charter',Charter,Georgia,serif;font-weight:700;
  font-size:53px;line-height:1.05;margin:0;letter-spacing:-0.8px;text-wrap:balance}
p.does{font-size:21.5px;line-height:1.42;color:var(--muted);margin:13px 0 0}

/* The window. A thin chrome bar and the real screen under it — enough to read
   as a laptop without pretending to be a photograph of one. */
.win{margin:28px -64px 0;border-top:1px solid var(--border);
  border-bottom:1px solid var(--border);overflow:hidden;
  box-shadow:0 18px 44px rgba(28,33,39,.13)}
.chrome{height:34px;background:#F1EFE9;border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:7px;padding:0 12px}
.chrome i{width:9px;height:9px;border-radius:50%;background:#D6D2C7;display:block}
.chrome .where{margin-left:10px;font-size:11px;color:var(--muted);letter-spacing:.4px}
.win img{width:100%;display:block}

.how{margin:32px 0 0}
.how h2{font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;
  color:var(--muted);margin:0 0 12px}
.how ol{margin:0;padding:0;list-style:none;counter-reset:s}
.how li{counter-increment:s;position:relative;padding-left:40px;margin-bottom:14px;
  font-size:19px;line-height:1.4}
.how li::before{content:counter(s);position:absolute;left:0;top:2px;
  width:26px;height:26px;border-radius:50%;background:var(--green);color:#fff;
  font-size:13px;font-weight:700;text-align:center;line-height:26px}

.note{margin:22px 0 0;padding:13px 0 13px 17px;border-left:3px solid var(--green);
  font-size:18px;line-height:1.4;color:var(--deep);background:var(--soft);
  border-radius:0 5px 5px 0;padding-right:14px}
`;

function page(shot, key, group) {
  const f = guide.forFeature(key);
  if (!f) throw new Error(`no guide entry for "${key}"`);
  const b64 = fs.readFileSync(path.join(SHOTS, `${shot}.png`)).toString('base64');

  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <div class="brand">
    <div class="mk">Kairos <i>by Exousia</i></div>
    <div class="tag">Protected</div>
  </div>
  <p class="kicker">${group}</p>
  <h1>${f.title}</h1>
  <p class="does">${f.does}</p>
  <div class="win">
    <div class="chrome"><i></i><i></i><i></i><span class="where">${f.title}</span></div>
    <img src="data:image/png;base64,${b64}">
  </div>
  <div class="how">
    <h2>How you use it</h2>
    <ol>${(f.how || []).map((h) => `<li>${h}</li>`).join('')}</ol>
  </div>
  ${f.note ? `<p class="note">${f.note}</p>` : ''}
</body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let failed = 0;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();

  for (const [i, [shot, key, group]] of POSTS.entries()) {
    const n = String(i + 1).padStart(2, '0');
    const src = path.join(SHOTS, `${shot}.png`);
    if (!fs.existsSync(src)) {
      console.log(`  ✗ ${n} ${shot}: no screenshot at ${src} — run wide.js first`);
      failed += 1;
      continue;
    }

    const html = path.join(OUT, `.${n}.html`);
    fs.writeFileSync(html, page(shot, key, group));
    await p.goto(`file://${html}`);
    await p.waitForTimeout(300);

    const m = await p.evaluate((limit) => {
      const im = document.querySelector('.win img');
      const last = document.querySelector('.note') || document.querySelector('.how');
      const r = last.getBoundingClientRect();
      return {
        decoded: im ? im.naturalWidth : 0,
        shotH: Math.round(document.querySelector('.win').getBoundingClientRect().height),
        docH: document.documentElement.scrollHeight,
        lastBottom: Math.round(r.bottom),
        steps: document.querySelectorAll('.how li').length,
        limit,
      };
    }, H);

    if (!m.decoded) {
      console.log(`  ✗ ${n} ${shot}: the screenshot did not decode`);
      failed += 1; continue;
    }
    if (!m.steps) {
      console.log(`  ✗ ${n} ${shot}: the guide entry has no steps — nothing to explain`);
      failed += 1; continue;
    }
    // The two ways this design goes wrong, and both are silent.
    if (m.docH > m.limit) {
      console.log(`  ✗ ${n} ${shot}: content overflows the canvas by ${m.docH - m.limit}px`);
      failed += 1; continue;
    }
    if (m.lastBottom > m.limit - 8) {
      console.log(`  ✗ ${n} ${shot}: the last block ends at y=${m.lastBottom} of ${m.limit} — too close to the cut`);
      failed += 1; continue;
    }

    const file = path.join(OUT, `${n}-${shot}.png`);
    await p.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
    fs.rmSync(html);
    console.log(`  ✓ ${n} ${shot.padEnd(15)} ${m.steps} steps · window ${m.shotH}px · ends y=${m.lastBottom}`);
  }

  await browser.close();
  console.log(`\n${POSTS.length - failed} of ${POSTS.length} explainers written to ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
