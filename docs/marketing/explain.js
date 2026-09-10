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
// The media block is the only thing that differs between the two sets, so it
// is a mode rather than a second file: the guide reading, the step layout and
// the overflow checks are the parts worth having in one place.
//   window — the laptop screen full-bleed, from wide-shots
//   phone  — a device in the middle, from phone-shots
const SHAPE = (process.argv[4] || 'window').toLowerCase();
if (!['window', 'phone'].includes(SHAPE)) throw new Error(`unknown shape "${SHAPE}"`);
const ONPHONE = SHAPE === 'phone';
const W = 1080, H = 1350;

// shot file, guide key, the group it sits under in the rail, and optionally an
// override object.
//
// The kicker is the rail's own grouping, so somebody who has seen two of these
// already knows where in the app they are.
//
// The override carries `top` — how far down the screenshot to start the phone's
// window, in source pixels. It defaults to clearing the app header, but a
// screen with a "not yet" badge partway down wants a crop chosen to frame past
// it, and wide.js prints each badge's y position for exactly that.
//
// It can also carry `title`, `does`, `how` and `note`, for a post about
// something the guide has no entry of its own for — the reporting flow is
// several posts and the guide has one `report`.
const POSTS = [
  ['today', 'today', 'The day'],
  ['catch-up', 'catch_up', 'The day'],
  ['itinerary', 'itinerary', 'The day'],
  ['pad', 'pad', 'The day'],
  ['trips', 'trips', 'The day'],
  ['desk', 'desk', 'The desk'],
  ['report', 'report', 'The desk'],
  // The reporting flow. The guide has one `report` entry, so the two posts
  // that follow carry their own words — taken from what the screen itself
  // says, not invented: "Showing 1 of 5 parts. The document and the
  // spreadsheet carry the same choice, and say on the first line that they
  // are a part."
  ['report-parts', null, 'The desk', {
    title: 'Only the part you need',
    does: 'A report comes in five parts. Ask for one and the rest fall away — '
      + 'and whatever you export carries the same choice.',
    how: [
      'Press a part: what the office did, what is still open, who looked at what, '
        + 'the week ahead, or what needs attention.',
      'The line under the chips says which part you are reading and how many there are.',
      'Press All of it to put the rest back.',
    ],
  }],
  ['report-export', null, 'The desk', {
    title: 'Take it away',
    does: 'The same report as a document to read or a spreadsheet to count, '
      + 'made out to the person it is for.',
    how: [
      'Choose who it is for — everyone, or one person in the office.',
      'Document reads as prose. Spreadsheet is for adding up.',
      'Whichever part you chose is the part that comes out, and it says so on its first line.',
    ],
    note: 'A report about one assistant is made for that assistant. It is not a '
      + 'league table of the office.',
    // 718, not 900: a 3360px capture fills a 736px glass from 718 exactly, and
    // the fill check said so rather than letting a blank strip through.
    top: 718,
  }],
  ['correspondence', 'correspondence', 'The desk'],
  ['spaces', 'spaces', 'Work'],
  ['tasks', 'tasks', 'Work'],
  ['archive', 'archive', 'Work'],
  ['connections', 'connections', 'The house'],
  // Cropped below the booking-link box. That box shows whatever origin the
  // browser used, which on a capture is http://127.0.0.1:4861 — a real thing
  // to render and a silly thing to post. The roster and the access code are
  // what this screen is about, and they are both below it. 718 is the largest
  // top that still fills the glass from a 3360px capture.
  ['team', 'members', 'Account', { top: 718 }],
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

/* ---- the phone ------------------------------------------------------
   Told its height explicitly. The screenshot inside is absolutely
   positioned and contributes none, and a device left to size itself from
   its contents collapses to a strip of bezel — which is how fourteen blank
   posts once shipped from this directory. */
.rig{margin:22px 0 0;display:flex;justify-content:center}
.phone{position:relative;width:350px;height:760px;flex:0 0 auto;
  background:#14181C;border-radius:42px;padding:12px;
  box-shadow:0 22px 54px rgba(28,33,39,.26)}
.glass{position:relative;width:326px;height:736px;overflow:hidden;
  border-radius:31px;background:#FFFFFF}
/* A status band the app renders below, so the notch never lands on the
   screen's own first line. */
.band{position:absolute;top:0;left:0;right:0;height:24px;background:#FFF;z-index:2}
.notch{position:absolute;top:0;left:50%;transform:translateX(-50%);
  width:104px;height:19px;background:#14181C;border-radius:0 0 11px 11px;z-index:3}
.view{position:absolute;top:24px;left:0;right:0;bottom:0;overflow:hidden}
.view img{position:absolute;left:0;width:326px;display:block}
`;

// Source pixels to slide the phone's window down by. The app header — title
// row, then search and avatar, then a divider — ends around y=340 in a 3x
// capture, and a crop inside it leaves half a search button floating at the
// top of the glass, which reads as a rendering fault rather than a screen.
const HEADER = 360;

function page(shot, key, group, over = {}) {
  const base = key ? guide.forFeature(key) : null;
  if (key && !base) throw new Error(`no guide entry for "${key}"`);
  const f = { ...(base || {}), ...over };
  if (!f.title || !f.does) throw new Error(`${shot}: no title or description to show`);
  const b64 = fs.readFileSync(path.join(SHOTS, `${shot}.png`)).toString('base64');
  const OFFSET = Math.round((over.top || HEADER) * (326 / 1170));

  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <div class="brand">
    <div class="mk">Kairos <i>by Exousia</i></div>
    <div class="tag">Protected</div>
  </div>
  <p class="kicker">${group}</p>
  <h1>${f.title}</h1>
  <p class="does">${f.does}</p>
  ${ONPHONE ? `<div class="rig">
    <div class="phone"><div class="glass">
      <div class="band"></div><div class="notch"></div>
      <div class="view"><img src="data:image/png;base64,${b64}" style="top:-${OFFSET}px"></div>
    </div></div>
  </div>` : `<div class="win">
    <div class="chrome"><i></i><i></i><i></i><span class="where">${f.title}</span></div>
    <img src="data:image/png;base64,${b64}">
  </div>`}
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

  for (const [i, [shot, key, group, over]] of POSTS.entries()) {
    const n = String(i + 1).padStart(2, '0');
    const src = path.join(SHOTS, `${shot}.png`);
    if (!fs.existsSync(src)) {
      console.log(`  ✗ ${n} ${shot}: no screenshot at ${src} — run wide.js first`);
      failed += 1;
      continue;
    }

    const html = path.join(OUT, `.${n}.html`);
    fs.writeFileSync(html, page(shot, key, group, over || {}));
    await p.goto(`file://${html}`);
    await p.waitForTimeout(300);

    const m = await p.evaluate((limit) => {
      const im = document.querySelector('.win img, .view img');
      const last = document.querySelector('.note') || document.querySelector('.how');
      const r = last.getBoundingClientRect();
      return {
        decoded: im ? im.naturalWidth : 0,
        shotH: Math.round(document.querySelector('.win, .phone').getBoundingClientRect().height),
        docH: document.documentElement.scrollHeight,
        lastBottom: Math.round(r.bottom),
        steps: document.querySelectorAll('.how li').length,
        // How far the screenshot falls short of the bottom of the glass, if at
        // all. Positive means a blank strip is showing inside the device.
        short: (() => {
          const g = document.querySelector('.glass');
          const v = document.querySelector('.view img');
          if (!g || !v) return 0;
          return Math.round(g.getBoundingClientRect().bottom - v.getBoundingClientRect().bottom);
        })(),
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
    if (m.short > 0) {
      console.log(`  ✗ ${n} ${shot}: the screenshot stops ${m.short}px above the bottom of `
        + 'the glass — a blank strip inside the phone. Capture a taller viewport.');
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
  console.log(`\n${POSTS.length - failed} of ${POSTS.length} explainers written to ${OUT}`
    + `  (${SHAPE})`);
  process.exit(failed ? 1 : 0);
})();
