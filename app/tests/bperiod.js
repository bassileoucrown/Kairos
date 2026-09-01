// A report for any stretch of days, and the custody trail inside it.
//
// TWO CHANGES, ONE FILE, because they are the same request: a report that can
// only cover Monday-to-Sunday cannot answer "what happened while I was in
// Geneva", and a report that says a document was looked at three times cannot
// answer "which document".
//
// THE ASSERTION THIS FILE EXISTS FOR is the second one. The trail says WHO
// OPENED WHAT — the passport, on Tuesday, by name — and that is the
// principal's own record of their own essentials. A Chief of Staff runs the
// office and sees everyone's counts; they do not get the custody trail, and
// the principal's access code would mean very little if a weekly report handed
// it to everybody senior. So the negative is tried from both a PA and a Chief
// of Staff, and the positive control sits beside it.
//
// AND THE FILE GOES THROUGH THE SAME GATE. An export is forwarded to people
// who were never in the app, so a copied access rule does its damage there.
// Both routes read scopeFor; this proves they agree.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4631, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const SECRET = 'inbound-secret-for-tests';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { s: r.status, d: json, text, headers: r.headers };
  };
}

/** A date N days from today, as the picker would send it. */
function dayKey(offset = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

(async () => {
  const fs = require('fs');
  const { spawn } = require('child_process');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      INBOUND_EMAIL_SECRET: SECRET, INBOUND_EMAIL_DOMAIN: 'in.test',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    const deadline = Date.now() + 150000;
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
      if (Date.now() > deadline) throw new Error('no server');
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    const up = await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const bossId = up.d.user.id;
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    let inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);
    const paId = (await pa('GET', '/auth/me')).d.user.id;

    const cos = client();
    await cos('POST', '/auth/signup',
      { name: 'Emeka Obi', email: `emeka${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    await cos('POST', '/profile/onboarding-step', { step: 'done' });
    inv = await boss('POST', '/members', { email: `emeka${ID}@x.com`, role: 'chief_of_staff' });
    await cos('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // ---- Any stretch of days ---------------------------------------------------
    head('A report can be asked for by date rather than by the week:');
    let r = await boss('GET', `/report/${bossId}?from=${dayKey(-9)}&to=${dayKey(-3)}`);
    ok('the dates asked for are the dates reported',
      r.s === 200 && r.d.window.startDate === dayKey(-9) && r.d.window.endDate === dayKey(-3),
      `${r.s} ${JSON.stringify(r.d.window)}`);
    // Marked, so the screen and the document can stop calling it "the week of".
    ok('and it says it is a period rather than a week', r.d.window.custom === true);

    // Both ends included, which is what a person means by "the 1st to the 15th".
    r = await boss('GET', `/report/${bossId}?from=${dayKey(0)}&to=${dayKey(0)}`);
    ok('a single day is a period of one day',
      r.s === 200 && r.d.window.startDate === r.d.window.endDate, JSON.stringify(r.d.window));
    ok('and it is a whole day rather than an empty instant',
      Math.round((Date.parse(r.d.window.endAt) - Date.parse(r.d.window.startAt)) / 3600000) === 24,
      `${r.d.window.startAt} → ${r.d.window.endAt}`);

    head('And nonsense dates are refused rather than quietly answered:');
    // THE FAILURE THAT WOULD BE WORST is not an error — it is falling back to
    // last week and putting the dates somebody typed on top of it.
    for (const [what, qs] of [
      ['the end before the start', `from=${dayKey(-1)}&to=${dayKey(-9)}`],
      ['a date that is not one', 'from=last-tuesday&to=2026-01-01'],
      ['a stretch longer than a year', 'from=2020-01-01&to=2026-01-01'],
      ['only one end of it', `from=${dayKey(-3)}`],
    ]) {
      const bad = await boss('GET', `/report/${bossId}?${qs}`);
      ok(`${what} is refused`, bad.s === 400 && bad.d.code === 'bad_window',
        `${bad.s} ${JSON.stringify(bad.d).slice(0, 120)}`);
    }
    // POSITIVE CONTROL: with no dates at all it is still last week, so the
    // refusals above are the validation and not a route that stopped working.
    r = await boss('GET', `/report/${bossId}`);
    ok('and with no dates it is still last week', r.s === 200 && !r.d.window.custom,
      JSON.stringify(r.d.window));

    // ---- The custody trail -------------------------------------------------------
    head('Something worth logging happens:');
    const account = (await boss('POST', `/mail/${bossId}/accounts`,
      { kind: 'delegated', address: `office${ID}@exousia.test`, label: 'The office' })).d.account;
    r = await boss('PUT', `/mail/${bossId}/accounts/${account.id}/grants/${paId}`,
      { view: true, organise: true, sendMode: 'draft' });
    ok('the principal lets the PA into the correspondence', r.s === 201, String(r.s));

    head('The principal sees who did what:');
    // Today's window, because the grant just happened.
    const todayQs = `from=${dayKey(0)}&to=${dayKey(0)}`;
    r = await boss('GET', `/report/${bossId}?${todayQs}`);
    ok('the trail is on the principal\'s report', !!r.d.accessTrail,
      JSON.stringify(Object.keys(r.d)).slice(0, 200));
    const entries = r.d.accessTrail?.entries || [];
    ok('and it carries the entry rather than only a count',
      entries.some((e) => e.action === 'mail_grant'), JSON.stringify(entries).slice(0, 240));
    ok('naming who did it', entries.some((e) => e.actorName === 'Adaeze Okonkwo'),
      JSON.stringify(entries.map((e) => e.actorName)));
    ok('and what it was done to',
      entries.some((e) => /Ngozi Bello/.test(e.subject || e.field || '')),
      JSON.stringify(entries.map((e) => e.subject || e.field)).slice(0, 200));

    head('And nobody else does — the trail is the account holder\'s own:');
    // THE TWO NEGATIVES. A PA sees only their own line anyway; a Chief of Staff
    // sees the whole office and still does not get this.
    r = await pa('GET', `/report/${bossId}?${todayQs}`);
    ok('a PA gets a report with no trail in it', r.s === 200 && !r.d.accessTrail,
      `${r.s} ${JSON.stringify(r.d.accessTrail)}`);
    r = await cos('GET', `/report/${bossId}?${todayQs}`);
    ok('and a Chief of Staff does not get one either', r.s === 200 && !r.d.accessTrail,
      `${r.s} ${JSON.stringify(r.d.accessTrail)}`);
    // POSITIVE CONTROL: the Chief of Staff really is reading this office, so
    // the missing trail above is the rule rather than a failed request.
    ok('though the Chief of Staff does see the whole office',
      r.d.canSeeEveryone === true && r.d.scope === 'office',
      JSON.stringify({ sees: r.d.canSeeEveryone, scope: r.d.scope }));

    // ---- The file agrees with the screen -------------------------------------------
    head('And the document says the same thing to the same people:');
    r = await boss('GET', `/report/${bossId}/export?${todayQs}`);
    ok('the principal\'s document carries the trail',
      r.s === 200 && /Who looked at what/i.test(r.text), r.text.slice(0, 200));
    ok('with the entry in it', /Ngozi Bello/.test(r.text), 'not in the document');
    // A file is forwarded, which is exactly why this must not leak.
    r = await cos('GET', `/report/${bossId}/export?${todayQs}`);
    ok('the Chief of Staff\'s does not', r.s === 200 && !/Who looked at what/i.test(r.text),
      r.text.slice(0, 200));
    // POSITIVE CONTROL: their document is a real report, so the absence above
    // is the gate rather than an export that returned nothing.
    ok('though it is a real report all the same',
      /What the office did/i.test(r.text), r.text.slice(0, 200));

    head('The document is named and headed for the period it covers:');
    r = await boss('GET', `/report/${bossId}/export?from=${dayKey(-9)}&to=${dayKey(-3)}`);
    ok('the heading does not call a fortnight a week',
      !/The week of/i.test(r.text) && /The period/i.test(r.text),
      (r.text.match(/<h1>[^<]*<\/h1>/) || [''])[0]);
    ok('and the filename carries the day it starts',
      new RegExp(`${dayKey(-9)}\\.html`).test(r.headers.get('content-disposition') || ''),
      r.headers.get('content-disposition'));
    // The spreadsheet takes the same period, rather than quietly being a week.
    r = await boss('GET', `/report/${bossId}/export?from=${dayKey(-9)}&to=${dayKey(-3)}&format=csv`);
    ok('and the spreadsheet covers it too',
      r.s === 200 && r.text.includes(dayKey(-9)) && r.text.includes(dayKey(-3)),
      r.text.slice(0, 160));

    head('A refused period is refused in the file as well as on the screen:');
    // The export used to be the route where a validation gap would go unnoticed.
    r = await boss('GET', `/report/${bossId}/export?from=${dayKey(-1)}&to=${dayKey(-9)}`);
    ok('the document refuses the same dates the screen refuses',
      r.s === 400 && r.d?.code === 'bad_window', `${r.s} ${r.text.slice(0, 120)}`);

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nA report covers any days you ask for, and who opened what is the principal\'s alone.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
