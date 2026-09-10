// A month of daily posts, each one a real Kairos screen in a phone.
//
// WHAT CHANGED FROM THE FIRST SERIES. The first sixteen posts explained the
// product in words on a coloured field, with a drawn phone. These show the
// screen itself. The argument is the same and the evidence is better: a person
// scrolling past sees what they would actually be looking at on their own
// phone, which is the only claim marketing can make that cannot be exaggerated.
//
// THE SHOTS ARE NOT DRAWN AND NOT TOUCHED UP. They come from screens.js, which
// runs the real server, seeds a real principal with a real assistant and a real
// household, and photographs the running app. If a screen is ugly the post is
// ugly. That is deliberate — a marketing pipeline that can quietly improve on
// the product is a pipeline that will.
//
// IT IS NOT TWO PEOPLE. The first series led twice with "one diary, two
// people" and that framing is wrong: `memberships` is many-per-principal
// across three assistant roles, `household_members` is a separate population
// again, and the family is a third. The honest line is one principal and the
// whole office and household around them, each seeing only their part — so
// four of these fourteen are about somebody who is not the principal.
//
// WHAT IS DELIBERATELY NOT IN THEM. No passports, no encryption, no second
// factor, no reveal trail, no custody, no vault. Standing instruction while
// the product is not ready to be asked about those in public — and the right
// call anyway, because a security claim is not the first thing that makes
// sense to a stranger.
//
// EVERY POST IS CHECKED FOR OVERFLOW AND FOR ITS PICTURE. The canvas is a
// fixed pixel size, so content past it is cropped silently and the image still
// looks finished — the first infographic lost its whole footer that way. And a
// missing screenshot renders as an empty phone, which looks like a design
// choice rather than a fault. Both fail the run.

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core'));

// Resolved, not taken as given: the rendered page is loaded over file://, and
// a relative path there is not a URL at all — it fails as ERR_INVALID_URL the
// moment this is run from anywhere but its own directory.
const SHOTS = path.resolve(process.argv[3] || path.join(__dirname, 'shots'));
const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'daily'));
const W = 1080, H = 1350;

// ── The posts ──────────────────────────────────────────────────────────────
// `shot` names a file in shots/. `top` is how far down the screenshot to slide
// the phone's window, in source pixels — the way to put the interesting part of
// a screen behind the glass instead of whatever happens to be at the top.
//
// It never goes below 360 on an app screen. The app header — title row, then
// search and avatar, then a divider — ends around source y=340, and a crop
// inside it leaves half a search button and half an avatar floating at the top
// of the glass, which reads as a rendering fault rather than as a screen. The
// public booking page has its own much shorter header and is the exception.
const POSTS = [
  {
    shot: 'today', top: 360,
    kicker: 'Day one',
    title: 'Open it once.<br>Know the whole day.',
    lede: 'What is happening now, what is next, and how long you actually have '
      + 'in between. Not a grid you have to read — a day you can take in.',
  },
  {
    shot: 'workspace', top: 360,
    kicker: 'For the people who run it',
    title: 'A desk of your own.',
    lede: 'If you run someone’s diary you know the problem: you do the work, and '
      + 'the tool gives you a corner of somebody else’s calendar. Kairos gives '
      + 'you a desk, and it holds every principal you run.',
  },
  {
    shot: 'household', top: 360,
    kicker: 'The house',
    title: 'An instruction nobody confirmed is a hope.',
    lede: 'Ask the driver, the chef, the housekeeper — and see, in one place, '
      + 'who has actually said they got it.',
  },
  {
    shot: 'instructions', top: 360,
    kicker: 'The house',
    title: 'What the driver sees.',
    lede: 'One screen: what they were asked, when it is for, and a button that '
      + 'says they have it. Not the diary. Not the contacts. Nothing else.',
  },
  {
    shot: 'booking', top: 200,
    kicker: 'Who gets in',
    title: 'A link that does not hand over your Tuesday.',
    lede: 'Some meetings confirm themselves. Some arrive as a request your '
      + 'office answers. A stranger and a board member are not the same person.',
  },
  {
    shot: 'itinerary', top: 360,
    kicker: 'Further out',
    title: 'The fortnight, not just the hour.',
    lede: 'Flights, meetings, the drive to the airport — one list, in order, '
      + 'and only the parts each person is allowed to see.',
  },
  {
    shot: 'desk', top: 360,
    kicker: 'For the people who run it',
    title: 'Everything waiting on you, in one place.',
    lede: 'How many places do you check this morning before you know what needs '
      + 'an answer today?',
  },
  {
    shot: 'pad', top: 360,
    kicker: 'Small things',
    title: 'The thought you had in the car.',
    lede: 'One line, written where the office will see it. It does not have to '
      + 'become an email before it counts.',
  },
  {
    shot: 'movements', top: 360,
    kicker: 'Getting there',
    title: 'Which car, whose licence, and whether the papers are current.',
    lede: 'The vehicle particulars expire where nobody is looking. Kairos looks.',
  },
  {
    shot: 'trips', top: 360,
    kicker: 'Getting there',
    title: 'A trip is more than a flight.',
    lede: 'The journey to the airport, who is travelling, and what waits at the '
      + 'other end — held together instead of scattered across a thread.',
  },
  {
    shot: 'team', top: 360,
    kicker: 'Who gets in',
    title: 'You decide who gets in, and for how long.',
    lede: 'A code you choose, read down the phone with your handle. It is off by '
      + 'default, lives only for the window you set, and is spent after the '
      + 'joins you allowed.',
  },
  {
    shot: 'spaces', top: 360,
    kicker: 'Working',
    title: 'The conversation, kept with the thing it is about.',
    lede: 'A lease, a trip, a board matter. Not four hundred messages in one '
      + 'thread that everybody has to scroll.',
  },
  {
    shot: 'report', top: 360,
    kicker: 'Looking back',
    title: 'The week, written for the person who was not in it.',
    lede: 'What happened, what moved, what is still waiting. Once, at the end, '
      + 'instead of asked for on a Sunday night.',
  },
  {
    shot: 'coming', top: 360,
    kicker: 'Plainly',
    title: 'The screen that says what we have not switched on yet.',
    lede: 'Every feature that is not live on your deployment, what it is waiting '
      + 'for, and where it will appear. It removes each entry itself the day we '
      + 'turn it on.',
  },
];

// ── The look, lifted from app/client/src/styles.css ─────────────────────────
const CSS = `
:root{
  --paper:#FAF9F6; --ink:#1C2127; --muted:#6B6659; --green:#3E6357;
  --deep:#24372F; --gold:#8A6A24; --gold-l:#C9A548; --border:#E3E0D6;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:${W}px;height:${H}px;overflow:hidden;background:var(--paper);
  color:var(--ink);
  font-family:'Liberation Sans',Arial,Helvetica,sans-serif;
  display:flex;flex-direction:column}

/* The frame every post shares, so somebody meeting the fourth one first has
   already learned where the name sits. */
.brand{padding:40px 64px 0;display:flex;align-items:baseline;gap:14px;flex:0 0 auto}
.brand .mk{font-family:'Bitstream Charter',Charter,Georgia,serif;
  font-size:30px;font-weight:700;letter-spacing:-0.3px}
.brand .mk i{font-style:normal;color:var(--gold)}
.brand .tag{margin-left:auto;font-size:13px;letter-spacing:2.6px;
  text-transform:uppercase;font-weight:700;color:var(--muted)}

.say{padding:26px 64px 0;flex:0 0 auto}
.kicker{font-size:14px;font-weight:700;letter-spacing:3.4px;text-transform:uppercase;
  color:var(--gold);margin:0 0 14px}
h1{font-family:'Bitstream Charter',Charter,Georgia,serif;font-weight:700;
  font-size:52px;line-height:1.08;margin:0;letter-spacing:-0.8px;
  text-wrap:balance}
p.lede{font-size:22px;line-height:1.45;color:var(--muted);margin:16px 0 0;
  max-width:930px}

/* The phone. It bleeds off the bottom on purpose: a whole device floating in
   the middle of a post reads as a stock image, and a cropped one reads as a
   screen you are looking over somebody's shoulder at. */
/* The phone must be told how tall it is. The screenshot inside is absolutely
   positioned, so it contributes no height at all — the first version left the
   device to size itself from its contents and it collapsed to fourteen pixels
   of bezel sitting on the bottom edge, on all fourteen posts. align-items
   stays "stretch" for the same reason: "flex-end" would cancel the stretch and
   put the collapse back. */
.stage{flex:1;position:relative;display:flex;justify-content:center;
  align-items:stretch;overflow:hidden;margin-top:30px}
.phone{position:relative;width:538px;flex:0 0 auto;height:100%;
  background:#14181C;border-radius:56px 56px 0 0;padding:14px 14px 0;
  box-shadow:0 -2px 0 rgba(0,0,0,.35), 0 34px 80px rgba(28,33,39,.28)}
.glass{position:relative;width:510px;height:100%;overflow:hidden;
  border-radius:44px 44px 0 0;background:#FFFFFF}

/* A status band, and the app renders below it — which is what a real phone
   does and what stops the notch landing on the screen's own first line. The
   first version floated the notch straight over the screenshot and it sat
   across "Adaeze Okonkwo" on the booking page. A per-post nudge would have
   fixed that one post and left the next new screen to rediscover it. */
.band{position:absolute;top:0;left:0;right:0;height:34px;background:#FFFFFF;z-index:2}
.notch{position:absolute;top:0;left:50%;transform:translateX(-50%);
  width:150px;height:26px;background:#14181C;border-radius:0 0 16px 16px;z-index:3}
.view{position:absolute;top:34px;left:0;right:0;bottom:0;overflow:hidden}
.view img{position:absolute;left:0;width:510px;display:block}

.foot{position:absolute;left:64px;bottom:40px;font-size:16px;color:var(--muted);
  z-index:3}
`;

function page(post) {
  const src = path.join(SHOTS, `${post.shot}.png`);
  const b64 = fs.readFileSync(src).toString('base64');
  // The shots are 1170px wide at 3× for a 390px phone; the glass is 510px, so
  // the source scales by 510/1170 and `top` is given in source pixels.
  const scale = 510 / 1170;
  const offset = Math.round((post.top || 0) * scale);

  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <div class="brand">
    <div class="mk">Kairos <i>by Exousia</i></div>
    <div class="tag">Protected</div>
  </div>
  <div class="say">
    <p class="kicker">${post.kicker}</p>
    <h1>${post.title}</h1>
    <p class="lede">${post.lede}</p>
  </div>
  <div class="stage">
    <div class="phone">
      <div class="glass">
        <div class="band"></div>
        <div class="notch"></div>
        <div class="view">
          <img src="data:image/png;base64,${b64}" style="top:-${offset}px">
        </div>
      </div>
    </div>
    <div class="foot">Lagos, Nigeria</div>
  </div>
</body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let failed = 0;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();

  const made = [];
  for (const [i, post] of POSTS.entries()) {
    const n = String(i + 1).padStart(2, '0');
    const src = path.join(SHOTS, `${post.shot}.png`);
    if (!fs.existsSync(src)) {
      console.log(`  ✗ ${n} ${post.shot}: no screenshot at ${src} — run screens.js first`);
      failed += 1;
      continue;
    }

    const html = path.join(OUT, `.${n}.html`);
    fs.writeFileSync(html, page(post));
    await p.goto(`file://${html}`);
    await p.waitForTimeout(280);

    // Did the picture actually arrive? A broken data URI renders as an empty
    // phone, which looks like a design choice.
    const shown = await p.evaluate(() => {
      const im = document.querySelector('.view img');
      return { w: im?.naturalWidth || 0, h: im?.naturalHeight || 0 };
    });
    if (!shown.w) {
      console.log(`  ✗ ${n} ${post.shot}: the screenshot did not decode`);
      failed += 1;
      continue;
    }

    // MEASURE THE PHONE, NOT THE DOCUMENT.
    //
    // The first two checks here could not fail. `scrollHeight > 1350` never
    // fires because the body is a fixed-height column with overflow hidden —
    // a too-tall headline squeezes the stage instead of overflowing. And
    // "the copy must not reach the phone" never fires because flexbox pushes
    // the two apart by construction. Both passed while every post rendered as
    // blank paper with fourteen pixels of bezel at the bottom.
    //
    // What actually goes wrong is the phone losing its height, so that is what
    // is measured: where the device really is on the canvas, and how much of
    // the screenshot is really behind the glass.
    const seen = await p.evaluate(() => {
      const ph = document.querySelector('.phone').getBoundingClientRect();
      const im = document.querySelector('.view img').getBoundingClientRect();
      const gl = document.querySelector('.glass').getBoundingClientRect();
      return {
        phoneTop: Math.round(ph.top), phoneH: Math.round(ph.height),
        // How many pixels of screenshot sit inside the glass and on the canvas.
        visible: Math.round(Math.min(im.bottom, gl.bottom, window.innerHeight)
          - Math.max(im.top, gl.top, 0)),
      };
    });
    if (seen.phoneH < 520) {
      console.log(`  ✗ ${n} ${post.shot}: the phone is only ${seen.phoneH}px tall `
        + '— it has collapsed, the post is blank paper');
      failed += 1;
      continue;
    }
    if (seen.visible < 480) {
      console.log(`  ✗ ${n} ${post.shot}: only ${seen.visible}px of screen is showing`);
      failed += 1;
      continue;
    }
    if (seen.phoneTop > H - 620) {
      console.log(`  ✗ ${n} ${post.shot}: the phone starts at y=${seen.phoneTop}, too low `
        + '— the copy above it has grown');
      failed += 1;
      continue;
    }

    const file = path.join(OUT, `${n}-${post.shot}.png`);
    await p.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
    fs.rmSync(html);
    made.push({ n, shot: post.shot, title: post.title.replace(/<br>/g, ' ') });
    console.log(`  ✓ ${n} ${post.shot.padEnd(13)} ${post.title.replace(/<br>/g, ' ').slice(0, 52)}`);
  }

  await browser.close();
  console.log(`\n${made.length} of ${POSTS.length} posts written to ${OUT}`);
  process.exit(failed ? 1 : 0);
})();
