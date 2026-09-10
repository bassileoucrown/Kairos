// A month of Kairos by Exousia posts, from one place.
//
// WHY A GENERATOR AND NOT SIXTEEN FILES. Sixteen hand-made images drift: the
// green shifts, the footer says something slightly different, one of them
// still carries last month's name. Here the palette, the frame and the
// wordmark are written once, and a post is a few lines of content. Changing
// the brand is one edit and one re-run.
//
// WHAT IS DELIBERATELY NOT IN THESE. No passports, no encryption, no second
// factor, no reveal trail, no custody. That is the owner's instruction while
// the product is not yet ready to be asked about those in public, and it is
// also the right call for a first month: these posts have to be understood by
// somebody who has never heard the name, and a security claim is not the first
// thing that makes sense to them.
//
// EVERY POST IS CHECKED FOR OVERFLOW. The canvas is a fixed pixel size, so
// anything past it is cropped silently and the image still looks finished.
// The first render of the first infographic lost its entire footer that way.
// A post that overflows fails the run rather than shipping short.

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core'));

const OUT = process.argv[2] || path.join(__dirname, 'out');
const W = 1080, H = 1350;

// ── The palette, lifted from app/client/src/styles.css ───────────────────
const CSS = `
:root{
  --paper:#FAF9F6; --ink:#1C2127; --muted:#6B6659; --green:#3E6357;
  --deep:#24372F; --gold:#8A6A24; --gold-l:#C9A548; --border:#E3E0D6;
  --soft:#E9EFEC; --line:#EDEAE2;
  --serif:'Bitstream Charter','Charter',Georgia,serif;
  --sans:'Liberation Sans',Arial,Helvetica,sans-serif;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:${W}px;height:${H}px;overflow:hidden;background:var(--paper);
  color:var(--ink);font-family:var(--sans);display:flex;flex-direction:column}
body.dark{background:var(--deep);color:#fff}

/* The frame every post shares, so a stranger seeing the fourth one has
   already learned where the name sits. */
.brand{padding:38px 64px 0;display:flex;align-items:baseline;gap:12px}
.brand .mk{font-family:var(--serif);font-size:30px;font-weight:700}
.brand .mk i{font-style:normal;color:var(--gold)}
body.dark .brand .mk i{color:var(--gold-l)}
.brand .tag{margin-left:auto;font-size:14px;letter-spacing:2.4px;
  text-transform:uppercase;font-weight:700;color:var(--muted)}
body.dark .brand .tag{color:#8FA69C}

.main{flex:1;padding:30px 64px 0;display:flex;flex-direction:column;justify-content:center}

.kicker{font-size:15px;font-weight:700;letter-spacing:3.2px;text-transform:uppercase;
  color:var(--gold);margin:0 0 16px}
body.dark .kicker{color:var(--gold-l)}
h1.big{font-family:var(--serif);font-weight:700;font-size:74px;line-height:1.06;
  margin:0;letter-spacing:-1px}
h1.med{font-family:var(--serif);font-weight:700;font-size:52px;line-height:1.12;
  margin:0;letter-spacing:-0.6px}
p.lede{font-size:25px;line-height:1.42;color:var(--muted);margin:20px 0 0;max-width:900px}
body.dark p.lede{color:#C7D4CD}
.accent{color:var(--green)}
body.dark .accent{color:var(--gold-l)}

.foot{padding:0 64px 34px;display:flex;justify-content:space-between;
  align-items:baseline;font-size:15px;color:var(--muted)}
body.dark .foot{color:#8FA69C}
.foot b{color:var(--ink);font-weight:700}
body.dark .foot b{color:#DCE5E0}

/* Ticked lists — the workhorse */
ul.ticks{margin:30px 0 0;padding:0;list-style:none}
ul.ticks li{display:flex;gap:14px;align-items:flex-start;font-size:25px;
  line-height:1.34;padding:11px 0}
ul.ticks li svg{flex:0 0 auto;width:23px;height:23px;margin-top:4px;fill:none;
  stroke:var(--green);stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round}
body.dark ul.ticks li svg{stroke:var(--gold-l)}

/* Numbered steps — used only where the content is genuinely a sequence */
.steps{margin:34px 0 0;display:flex;flex-direction:column;gap:16px}
.step{display:flex;gap:18px;align-items:flex-start}
.step .n{flex:0 0 auto;width:42px;height:42px;border-radius:50%;background:var(--green);
  color:#fff;font-size:19px;font-weight:700;text-align:center;line-height:42px}
.step.last .n{background:var(--gold)}
.step .t{font-size:26px;font-weight:700;line-height:1.24}
.step .s{font-size:19px;color:var(--muted);margin-top:4px;line-height:1.34}
body.dark .step .s{color:#B9C6BF}

/* Two columns */
.cols{display:flex;gap:24px;margin-top:32px}
.col{flex:1;background:#fff;border:1px solid var(--border);border-radius:14px;
  padding:24px 26px 26px}
.col h3{font-family:var(--serif);font-size:28px;margin:0 0 4px;font-weight:700}
.col .sub{font-size:17px;color:var(--muted);margin:0 0 16px}
.col ul{margin:0;padding:0;list-style:none}
.col li{display:flex;gap:11px;align-items:flex-start;font-size:19px;
  line-height:1.32;padding:7px 0}
.col li svg{flex:0 0 auto;width:19px;height:19px;margin-top:3px;fill:none;
  stroke:var(--green);stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round}

/* ── The phone ─────────────────────────────────────────────────────── */
.phone{width:330px;background:#1C2127;border-radius:42px;padding:11px;
  box-shadow:0 14px 34px rgba(28,33,39,.16)}
.screen{background:var(--paper);border-radius:32px;overflow:hidden}
.notch{width:94px;height:6px;background:#3A4048;border-radius:3px;margin:5px auto 8px}
.ph-head{background:#fff;border-bottom:1px solid var(--line);padding:14px 17px 15px}
.ph-head .d{font-family:var(--serif);font-size:24px;font-weight:700}
.ph-head .z{font-size:14px;color:var(--muted);margin-top:2px}
.ph-body{padding:15px 17px 18px}
.now{border:1px solid var(--green);border-left:3px solid var(--green);
  background:var(--soft);border-radius:8px;padding:11px 13px;margin-bottom:12px}
.now .lab{font-size:12px;font-weight:700;letter-spacing:1.4px;color:var(--green);
  text-transform:uppercase}
.now .ttl{font-size:18px;font-weight:700;margin-top:3px}
.now .sub2{font-size:14px;color:var(--muted);margin-top:2px}
.item{display:flex;gap:11px;padding:10px 0;border-top:1px solid var(--line)}
.item .tm{font-size:14px;color:var(--muted);width:50px;flex:0 0 50px;font-weight:700}
.item .bd b{display:block;font-size:16.5px;font-weight:700}
.item .bd span{display:block;font-size:14px;color:var(--muted)}
.ph-foot{margin-top:13px;background:var(--green);color:#fff;border-radius:999px;
  text-align:center;font-size:15px;font-weight:700;padding:11px}

/* ── The desk window ───────────────────────────────────────────────── */
.win{border:1px solid var(--border);border-radius:14px;background:#fff;
  box-shadow:0 14px 34px rgba(28,33,39,.11);overflow:hidden}
.win-bar{height:34px;background:#F1EFE9;border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:7px;padding:0 14px}
.dot{width:10px;height:10px;border-radius:50%;background:#D6D2C7}
.tabs{display:flex;border-bottom:1px solid var(--line);background:#FCFBF8}
.tab{padding:13px 20px;font-size:16px;color:var(--muted);border-right:1px solid var(--line)}
.tab.on{color:var(--green);font-weight:700;background:#fff}
.tab .pip{display:inline-block;min-width:19px;padding:0 5px;margin-left:7px;
  background:var(--gold);color:#fff;border-radius:10px;font-size:12px;font-weight:700;
  text-align:center;line-height:17px}
.win-body{padding:18px 20px 20px}
.win-h{font-size:13px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;
  color:var(--muted);margin:0 0 12px}
.ask{display:flex;align-items:center;gap:11px;border:1px solid var(--line);
  border-radius:9px;padding:13px 15px;margin-bottom:10px}
.ask .t{flex:1}
.ask .t b{display:block;font-size:17.5px}
.ask .t span{display:block;font-size:15px;color:var(--muted);margin-top:2px}
.btn{font-size:14px;font-weight:700;padding:8px 15px;border-radius:999px;
  background:var(--green);color:#fff}
.btn.ghost{background:#fff;color:var(--muted);border:1px solid var(--border)}

.centre{flex:1;display:flex;flex-direction:column;justify-content:center}
.devrow{display:flex;gap:28px;align-items:flex-start;margin-top:30px}
.cap .who{font-family:var(--serif);font-size:24px;font-weight:700}
.cap .what{font-size:16px;color:var(--muted);margin-top:2px;margin-bottom:12px}
`;

const TICK = '<svg viewBox="0 0 24 24"><path d="M4 12.5 9.5 18 20 6"/></svg>';

const PHONE = `
<div class="phone"><div class="notch"></div><div class="screen">
  <div class="ph-head"><div class="d">Monday, 8 September</div>
    <div class="z">Lagos · 4 things today</div></div>
  <div class="ph-body">
    <div class="now"><div class="lab">Now</div><div class="ttl">Board meeting</div>
      <div class="sub2">Ends 11:30 · Boardroom</div></div>
    <div class="item"><div class="tm">12:30</div><div class="bd">
      <b>Lunch — Mrs Bello</b><span>Ikoyi · leave 12:00</span></div></div>
    <div class="item"><div class="tm">15:00</div><div class="bd">
      <b>Call with the bank</b><span>Video</span></div></div>
    <div class="item"><div class="tm">18:30</div><div class="bd">
      <b>Flight to Abuja</b><span>Driver confirmed</span></div></div>
    <div class="ph-foot">Plan the day</div>
  </div></div></div>`;

const DESK = `
<div class="win">
  <div class="win-bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div>
  <div class="tabs"><div class="tab on">Approvals <span class="pip">3</span></div>
    <div class="tab">Bookings</div><div class="tab">Briefs</div><div class="tab">Trips</div></div>
  <div class="win-body"><p class="win-h">Waiting on you</p>
    <div class="ask"><div class="t"><b>Intro call — Tunde A.</b>
      <span>Thursday 11:00 · 30 min · video</span></div>
      <span class="btn">Approve</span><span class="btn ghost">Decline</span></div>
    <div class="ask"><div class="t"><b>Site visit — Lekki</b>
      <span>Friday 08:30 · needs a car</span></div>
      <span class="btn">Approve</span><span class="btn ghost">Decline</span></div>
    <div class="ask"><div class="t"><b>Brief for the board meeting</b>
      <span>Ready to send to the principal</span></div>
      <span class="btn">Send</span></div>
  </div></div>`;

const ticks = (arr) => `<ul class="ticks">${arr.map((t) => `<li>${TICK}${t}</li>`).join('')}</ul>`;

// ── The month ────────────────────────────────────────────────────────────
const POSTS = [
  { id: '01-what-it-is', week: 1, dark: true,
    kicker: 'What it is',
    title: 'One diary.<br>Everyone around it.',
    lede: 'The principal, their assistants, the house, the family — each on their own screen, each seeing only their part.' , tag: 'Start here' },

  { id: '02-the-day', week: 1,
    kicker: 'The principal’s day',
    title: 'Open it once.<br>Know the whole day.',
    device: 'phone',
    ticks: ['What is happening now, at the top',
            'When to leave, not just when to arrive',
            'The whole day in order — nothing to piece together'] , tag: 'For principals' },

  { id: '03-the-desk', week: 1,
    kicker: 'The assistant’s desk',
    title: 'A desk of your own.',
    lede: 'Not a corner of somebody else’s calendar.',
    device: 'desk',
    ticks: ['Every request in one queue, to approve or decline',
            'Briefs, instructions and minutes kept where they belong'] , tag: 'For assistants' },

  { id: '04-how-it-works', week: 1, steps: true,
    kicker: 'How it works',
    title: 'How a meeting reaches the diary.',
    stepList: [
      ['Someone asks for time', 'Through your booking link, or the office adds it'],
      ['The desk decides', 'Approve, decline, or offer another time'],
      ['It is on the day', 'On the principal’s phone, in order, with travel time'],
    ] , tag: 'How it works' },

  { id: '05-not-everyone', week: 2, dark: true,
    kicker: 'Booking',
    title: 'Not everyone who finds your link should get your Tuesday.',
    lede: 'A stranger and a board member are never treated the same. Some meetings confirm. Some become a request your assistant answers.' , tag: 'Booking' },

  { id: '06-one-queue', week: 2,
    kicker: 'For the assistant',
    title: 'Everything waiting on you, in one place.',
    device: 'desk',
    ticks: ['No inbox archaeology to find what needs an answer',
            'Approve, decline, or offer another time — in one tap'] , tag: 'For assistants' },

  { id: '07-many-principals', week: 2,
    kicker: 'For the assistant',
    title: 'You run three diaries.<br>You should not need three logins.',
    lede: 'One desk. Switch between the people you look after without signing out of anything.',
    ticks: ['One queue across every principal you run',
            'Their days stay separate — you do not',
            'Built for a Chief of Staff, not only a PA'] , tag: 'For assistants' },

  { id: '08-leave-on-time', week: 2,
    kicker: 'The day',
    title: 'Late is usually a travel problem, not a diary problem.',
    lede: 'Kairos reads the road at the hour you actually leave — not a number somebody typed in once and forgot.',
    device: 'phone' , tag: 'The day' },

  { id: '09-two-sides', week: 3, cols: true,
    kicker: 'Who it is for',
    title: 'Two screens.<br>The same diary.',
    colA: { h: 'If you are the principal', sub: 'You open it once and know the shape of your day.',
      li: ['Your day in order, now at the top',
           'Nobody takes a slot because they found your link',
           'Trips, drivers and travel time',
           'You decide what your office can see'] },
    colB: { h: 'If you run the diary', sub: 'A desk of your own, not a corner of someone else’s.',
      li: ['Requests in one queue, to approve or decline',
           'Briefs, instructions and minutes in one place',
           'Draft with help — nothing is sent without you',
           'More than one principal from the same desk'] } , tag: 'Who it is for' },

  { id: '10-drafts', week: 3, dark: true,
    kicker: 'Working together',
    title: 'It drafts.<br>You send.',
    lede: 'Kairos will write the reply, catch you up on what you missed, and read the week ahead. It never sends anything as you.' , tag: 'Working together' },

  { id: '11-trips', week: 3,
    kicker: 'The day',
    title: 'A trip is more than a flight time.',
    lede: 'Where you are going, who is driving, what time the car leaves, and who to call at the other end — held together as one thing.',
    ticks: ['Trips, movements and driver cards in one place',
            'The office sees what it needs to move you',
            'A journey link that names a place, never a person'] , tag: 'Travel' },

  { id: '12-whatsapp', week: 3,
    kicker: 'Built here',
    title: 'Built for how work actually happens in Lagos.',
    lede: 'Not a Silicon Valley calendar with a Nigerian flag on it.',
    ticks: ['Works when the network is poor',
            'Reads well on a phone, sideways or upright',
            'Written in the English an office here actually uses'] , tag: 'Built here' },

  { id: '13-quote-diary', week: 4, dark: true, statement: true,
    kicker: 'The short version',
    title: 'Your assistant runs your diary.<br>Not the rest of your life.' , tag: 'In short' },

  { id: '14-question', week: 4,
    kicker: 'A question',
    title: 'Who decides what goes into your week?',
    lede: 'For most busy people the honest answer is: whoever asked most recently. Kairos is for the people who would rather it were a decision.' , tag: 'A question' },

  { id: '15-both', week: 4, cols: false,
    kicker: 'For the office',
    title: 'The principal is not the only user.',
    lede: 'Every scheduling tool is built for the person doing the booking. Kairos is built for the person whose time is being spent — and the assistant who protects it.',
    ticks: ['The assistant gets a workspace, not a permission',
            'The principal gets a day they can read in one look',
            'Both are looking at the same diary'] , tag: 'Why it is different' },

  { id: '16-early-access', week: 4, dark: true,
    kicker: 'Early access',
    title: 'We are letting a few offices in.',
    lede: 'If you run a principal’s diary — or somebody runs yours — we would like you to try it and tell us where it is wrong.' , tag: 'Get in touch' },

];

function render(p) {
  const head = `<div class="brand"><span class="mk">Kairos <i>by Exousia</i></span>` +
    (p.tag ? `<span class="tag">${p.tag}</span>` : '') + `</div>`;

  const wordsOnly = !p.ticks && !p.stepList && !p.colA && !p.device;
  let body = `<p class="kicker">${p.kicker}</p>` +
    `<h1 class="${wordsOnly || p.statement ? 'big' : 'med'}">${p.title}</h1>`;
  if (p.lede) body += `<p class="lede">${p.lede}</p>`;
  if (p.ticks) body += ticks(p.ticks);
  if (p.stepList) {
    body += '<div class="steps">' + p.stepList.map(([t, s], i) =>
      `<div class="step${i === p.stepList.length - 1 ? ' last' : ''}">` +
      `<span class="n">${i + 1}</span><div><div class="t">${t}</div>` +
      `<div class="s">${s}</div></div></div>`).join('') + '</div>';
  }
  if (p.colA) {
    const col = (c) => `<div class="col"><h3>${c.h}</h3><p class="sub">${c.sub}</p>` +
      `<ul>${c.li.map((t) => `<li>${TICK}${t}</li>`).join('')}</ul></div>`;
    body += `<div class="cols">${col(p.colA)}${col(p.colB)}</div>`;
  }
  if (p.device === 'phone') body += `<div class="devrow" style="justify-content:center">${PHONE}</div>`;
  if (p.device === 'desk') body += `<div class="devrow">${DESK}</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<title>${p.id}</title><style>${CSS}</style></head>` +
    `<body class="${p.dark ? 'dark' : ''}">${head}` +
    `<div class="main${p.statement ? ' centre' : ''}">${body}</div>` +
    `<div class="foot"><b>Kairos by Exousia</b><span>Lagos, Nigeria</span></div>` +
    `</body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  let bad = 0;
  for (const p of POSTS) {
    const html = path.join(OUT, `${p.id}.html`);
    fs.writeFileSync(html, render(p));
    const page = await (await b.newContext({
      viewport: { width: W, height: H }, deviceScaleFactor: 2,
    })).newPage();
    await page.goto('file://' + html);
    await page.waitForTimeout(180);
    const over = await page.evaluate(() => document.documentElement.scrollHeight);
    // Loud, not silent: a cropped post still looks like a finished post.
    if (over > H) { console.log(`  ✗ ${p.id} OVERFLOWS by ${over - H}px`); bad += 1; }
    else console.log(`  ✓ ${p.id}`);
    await page.screenshot({ path: path.join(OUT, `${p.id}.png`),
      clip: { x: 0, y: 0, width: W, height: H } });
    await page.context().close();
  }
  await b.close();
  console.log(bad ? `\n${bad} post(s) overflow — fix before shipping.` : `\nAll ${POSTS.length} posts fit.`);
  process.exit(bad ? 1 : 0);
})();
