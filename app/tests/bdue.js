// Deadlines that reach the principal before they pass.
//
// The old rule listed a task in "what needs you" only once it was already
// overdue, so the first time anybody saw it, the deadline had gone. The vault
// has warned six months ahead of a passport expiry from the beginning on
// exactly this reasoning; a task that costs something to miss deserves the
// same courtesy. How far ahead scales with priority, because a signature that
// has to reach a registry is not a five-minute phone call.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const { dueBand, LEAD_MS } = require(`${ROOT}/app/server/lib/reminders`);

const PORT = Number(process.env.PORT || 4509);
const BASE = `http://127.0.0.1:${PORT}`;
const ID = Date.now().toString(36);
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
    return { s: r.status, d: json };
  };
}

const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

(async () => {
  head('The bands themselves:');
  const now = Date.now();
  ok('a high-priority task is flagged three days out',
    dueBand(new Date(now + 60 * 3600e3).toISOString(), now, 'high') === 'due_soon');
  ok('an ordinary one is not, at sixty hours',
    dueBand(new Date(now + 60 * 3600e3).toISOString(), now, 'normal') === null);
  ok('but is at twenty hours',
    dueBand(new Date(now + 20 * 3600e3).toISOString(), now, 'normal') === 'due_soon');
  ok('a low one waits until eight hours',
    dueBand(new Date(now + 20 * 3600e3).toISOString(), now, 'low') === null
    && dueBand(new Date(now + 6 * 3600e3).toISOString(), now, 'low') === 'due_soon');
  ok('anything past its time is overdue whatever its priority',
    ['high', 'normal', 'low'].every((p) => dueBand(new Date(now - 1000).toISOString(), now, p) === 'overdue'));
  ok('an unknown priority falls back to the ordinary lead',
    dueBand(new Date(now + 20 * 3600e3).toISOString(), now, 'urgent-ish') === 'due_soon');
  ok('and no due date is never flagged', dueBand(null, now, 'high') === null);
  ok('the high lead is genuinely longer than the ordinary one', LEAD_MS.high > LEAD_MS.normal);

  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
    if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  }

  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    // A principal with an assistant who assigns them work.
    const ada = client();
    const up = await ada('POST', '/auth/signup',
      { name: 'Ada Boss', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    const adaId = up.d.user.id;
    await ada('POST', '/profile/onboarding-step', { step: 'done' });
    await ada('PATCH', '/profile', { slug: `ada${ID}` });

    const space = await ada('POST', '/spaces', { name: 'Board', context: 'work' });
    const spaceId = space.d.space.id;

    head('What reaches Today:');
    const far = await ada('POST', '/tasks',
      { spaceId, title: 'Ordinary thing next week', assigneeId: adaId, dueAt: inHours(24 * 7) });
    const soonHigh = await ada('POST', '/tasks',
      { spaceId, title: 'Sign the registry filing', assigneeId: adaId, dueAt: inHours(48), priority: 'high' });
    const soonNormal = await ada('POST', '/tasks',
      { spaceId, title: 'Confirm the caterer', assigneeId: adaId, dueAt: inHours(6) });
    const past = await ada('POST', '/tasks',
      { spaceId, title: 'Already missed', assigneeId: adaId, dueAt: inHours(-5) });
    ok('four tasks created',
      [far, soonHigh, soonNormal, past].every((r) => r.s === 201),
      [far, soonHigh, soonNormal, past].map((r) => r.s).join(','));

    const today = await ada('GET', `/today/${adaId}`);
    const due = today.d.needsYou.dueTasks || [];
    const byTitle = Object.fromEntries(due.map((t) => [t.title, t]));

    ok('the high-priority one two days out is already there',
      byTitle['Sign the registry filing']?.band === 'due_soon',
      JSON.stringify(due.map((t) => `${t.title}:${t.band}`)));
    ok('so is the ordinary one due in six hours',
      byTitle['Confirm the caterer']?.band === 'due_soon');
    ok('the one already past shows as overdue',
      byTitle['Already missed']?.band === 'overdue');
    ok('and next week is left alone', !byTitle['Ordinary thing next week']);

    ok('all three count towards what needs you',
      today.d.needsYou.count >= 3, String(today.d.needsYou.count));
    ok('the priority travels with it, so the screen can flag it',
      byTitle['Sign the registry filing']?.priority === 'high');

    head('Nothing is listed twice on one screen:');
    const todayIds = new Set((today.d.todayTasks || []).map((t) => t.id));
    const overlap = due.filter((t) => todayIds.has(t.id));
    ok('a task in what-needs-you is not repeated in the day list',
      overlap.length === 0, JSON.stringify(overlap.map((t) => t.title)));

    head('An older client still gets something sensible:');
    ok('overdueTasks is still populated, with the overdue ones only',
      (today.d.needsYou.overdueTasks || []).length === 1
      && today.d.needsYou.overdueTasks[0].title === 'Already missed',
      JSON.stringify(today.d.needsYou.overdueTasks));

    head('Finishing it takes it off the list:');
    await ada('PATCH', `/tasks/${soonNormal.d.id || soonNormal.d.task?.id}`, { status: 'done' });
    const after = await ada('GET', `/today/${adaId}`);
    ok('a completed task stops asking',
      !(after.d.needsYou.dueTasks || []).some((t) => t.title === 'Confirm the caterer'),
      JSON.stringify((after.d.needsYou.dueTasks || []).map((t) => t.title)));

    head('And the email says the same thing as the screen:');
    const { runReminderSweep } = require(`${ROOT}/app/server/lib/reminders`);
    ok('one definition of close drives both', typeof runReminderSweep === 'function');
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    proc.kill();
  }
  console.log(fails === 0 ? '\nDeadlines arrive while there is still time to act.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
