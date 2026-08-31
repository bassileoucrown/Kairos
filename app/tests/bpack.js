// The report as a file, and the half of the week that has not happened yet.
//
// TWO THINGS ARE BEING PROVED AND ONLY ONE OF THEM IS A FEATURE.
//
//   THE FEATURE. A report can be taken away as a document — the week just
//   gone, what is coming, and what has been sitting untouched — for one person
//   or for the whole office.
//
//   THE THING THAT MATTERS MORE. A file gets forwarded. So the export must
//   carry exactly the same access rule as the screen: a PA entitled to their
//   own line downloads their own line and NOT a document containing the whole
//   office's names and numbers. When that rule lived only inside the GET
//   handler, adding a second route meant copying it, and a copied access rule
//   is a rule with two versions. The assertions about what is NOT in the file
//   are the point of this suite.
//
// AND ONE THING THAT IS NEITHER: a CSV cell beginning with = is executed as a
// formula by Excel and Sheets. Every field in this export is text somebody
// typed into the app. A thread named "=HYPERLINK(...)" would otherwise be code
// running on the machine of whoever opened the principal's report.
const ROOT = require('path').join(__dirname, '..', '..');

const PORT = 4618, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
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

const isoIn = (days) => new Date(Date.now() + days * 86400000).toISOString();
const isoAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();

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
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const db = require(`${ROOT}/app/server/lib/db`);

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

    // A PA, who sees only their own line, and a Chief of Staff, who sees all.
    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    let inv = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    const cos = client();
    await cos('POST', '/auth/signup',
      { name: 'Tunde Bakare', email: `tunde${ID}@x.com`, password: PW, accountCategory: 'chief_of_staff' });
    await cos('POST', '/profile/onboarding-step', { step: 'done' });
    inv = await boss('POST', '/members', { email: `tunde${ID}@x.com`, role: 'chief_of_staff' });
    await cos('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    // ---- Something to report on ---------------------------------------------
    const space = (await boss('POST', '/spaces', { name: 'The board', context: 'work' })).d.space;
    const project = (await boss('POST', `/spaces/${space.id}/projects`,
      { name: 'Ikoyi refurbishment' })).d.project;

    // A task set days ago, dated, and never picked up. This is the shape the
    // "needs attention" rule is defined around.
    const coldTask = await boss('POST', '/tasks',
      { spaceId: space.id, title: 'Chase the surveyor', dueAt: isoIn(4) });
    ok('a task can be set', coldTask.s === 201, `${coldTask.s} ${JSON.stringify(coldTask.d).slice(0, 120)}`);
    // Aged in the database rather than through a route. The rule is "created
    // more than three days ago", and a suite that waited three days would not
    // be a suite — but a test-only endpoint that back-dates rows is a hole
    // punched in production to make a test easier, which is a worse trade.
    await db.prepare('UPDATE tasks SET created_at = ? WHERE id = ?')
      .run(isoAgo(5), coldTask.d.task.id);

    // A fresh task, dated the same week. THE POSITIVE CONTROL for the rule:
    // it must be counted as falling due and must NOT be called neglected.
    const freshTask = await boss('POST', '/tasks',
      { spaceId: space.id, title: 'Book the caterer', dueAt: isoIn(3) });
    ok('and another one, set just now', freshTask.s === 201);

    const r0 = await boss('GET', `/report/${bossId}`);
    ok('the report comes back', r0.s === 200, String(r0.s));
    ok('and now carries the week ahead', !!r0.d.ahead, JSON.stringify(Object.keys(r0.d)).slice(0, 200));

    // ---- The week ahead ------------------------------------------------------
    head('The report says what is coming, not only what happened:');
    const ahead = r0.d.ahead;
    ok('it names the week it means',
      !!ahead.window?.startDate && ahead.window.startDate > ahead.window.startDate.slice(0, 4),
      JSON.stringify(ahead.window));
    ok('the window is next week, not last', ahead.window.startAt > new Date().toISOString(),
      `${ahead.window.startAt} vs now`);
    ok('it counts what falls due', Array.isArray(ahead.tasksDue), typeof ahead.tasksDue);
    ok('it has a list of what needs attention', Array.isArray(ahead.neglected?.items));

    // ---- Neglect, defined ----------------------------------------------------
    head('And it says what has been left alone, and why:');
    const titles = ahead.neglected.items.map((n) => n.title);
    ok('a dated task nobody started is on the list',
      titles.some((t) => /surveyor/.test(t)), JSON.stringify(titles));
    // THE POSITIVE CONTROL. Without this, a list that flagged EVERY task would
    // pass the assertion above while being useless.
    ok('a task set this morning is not',
      !titles.some((t) => /caterer/.test(t)), JSON.stringify(titles));
    const cold = ahead.neglected.items.find((n) => /surveyor/.test(n.title));
    // A list headed "needs attention" that does not say why cannot be argued
    // with, and a list nobody can argue with stops being read.
    ok('and each line says why it is there',
      /not started/.test(cold?.why || ''), cold?.why);
    ok('with somewhere to go', /^\/[a-z]/.test(cold?.href || ''), cold?.href);

    // ---- The file ------------------------------------------------------------
    head('The report can be taken away as a document:');
    let x = await boss('GET', `/report/${bossId}/export`);
    ok('the office downloads as a document', x.s === 200, String(x.s));
    ok('as an attachment, not a page in the app',
      /attachment/.test(x.headers.get('content-disposition') || ''),
      x.headers.get('content-disposition'));
    ok('named for the principal and the week',
      /kairos-adaeze-okonkwo-\d{4}-\d{2}-\d{2}\.html/.test(x.headers.get('content-disposition') || ''),
      x.headers.get('content-disposition'));
    ok('and it is a whole document, not a fragment',
      /^<!doctype html>/i.test(x.text.trim()), x.text.slice(0, 60));
    ok('carrying the week that happened', /What the office did/.test(x.text));
    ok('and the week that has not', /The week ahead/.test(x.text));
    ok('and what has been left alone', /Needs attention/.test(x.text) && /surveyor/.test(x.text));

    x = await boss('GET', `/report/${bossId}/export?format=csv`);
    ok('the numbers download as a spreadsheet', x.s === 200
      && /text\/csv/.test(x.headers.get('content-type') || ''), x.headers.get('content-type'));
    ok('with a row for each person',
      /Ngozi Bello/.test(x.text) && /Tunde Bakare/.test(x.text), x.text.slice(0, 200));

    // ---- Who is in the file --------------------------------------------------
    head('And the file carries the same rule as the screen:');
    // THE ASSERTION THIS SUITE EXISTS FOR.
    const paFile = await pa('GET', `/report/${bossId}/export?format=csv`);
    ok('a PA can download their own report', paFile.s === 200, String(paFile.s));
    ok('their own line is in it', /Ngozi Bello/.test(paFile.text), paFile.text.slice(0, 200));
    ok('and nobody else is', !/Tunde Bakare/.test(paFile.text), paFile.text.slice(0, 300));
    // POSITIVE CONTROL: the name IS in the office copy, so its absence above is
    // the rule working and not the export being empty.
    ok('though that name is in the office copy',
      /Tunde Bakare/.test((await cos('GET', `/report/${bossId}/export?format=csv`)).text));
    ok('and the file says which of the two it is',
      /your own line only/.test((await pa('GET', `/report/${bossId}/export`)).text));

    // Asking for one person is allowed to somebody who may see everyone...
    const one = await cos('GET', `/report/${bossId}/export?format=csv&person=${up.d.user.id}`);
    ok('somebody who sees the office can ask for one person',
      one.s === 200 && !/Ngozi Bello/.test(one.text), one.text.slice(0, 200));
    // ...and cannot be used by somebody who may not, to reach past their own line.
    const sneak = await pa('GET', `/report/${bossId}/export?format=csv&person=${up.d.user.id}`);
    ok('and a PA naming somebody else still gets only themselves',
      /Ngozi Bello/.test(sneak.text) && !/Tunde Bakare/.test(sneak.text), sneak.text.slice(0, 300));

    // ---- The spreadsheet is not a program ------------------------------------
    head('A name is text, even when it looks like a formula:');
    const evil = client();
    await evil('POST', '/auth/signup',
      { name: '=HYPERLINK("http://evil","click")', email: `evil${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await evil('POST', '/profile/onboarding-step', { step: 'done' });
    inv = await boss('POST', '/members', { email: `evil${ID}@x.com`, role: 'pa' });
    await evil('POST', `/invites/${inv.d.inviteLink.split('/').pop()}/accept`);

    const csv = (await boss('GET', `/report/${bossId}/export?format=csv`)).text;
    ok('the name is in the file', /HYPERLINK/.test(csv));
    // Quoted AND prefixed. Excel executes "=..." the moment the cell is read;
    // the leading apostrophe is what stops it being a formula.
    ok('but defused, so opening the file does not run it',
      csv.includes('"\'=HYPERLINK'), (csv.match(/.{0,25}HYPERLINK.{0,10}/) || [''])[0]);
    // And the HTML document escapes rather than embeds it.
    const html = (await boss('GET', `/report/${bossId}/export`)).text;
    ok('and the document escapes it rather than rendering it',
      !/<a [^>]*evil/.test(html) && /&quot;|&lt;/.test(html));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe week can be taken away as a document, and it carries the rule with it.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
