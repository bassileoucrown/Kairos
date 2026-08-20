// Could an unfinished setup lock somebody out? That is the only path on which
// "I never turned this on and it is asking me for a code" would be a bug.
const ROOT = require('path').join(__dirname, '..', '..');
const { spawn } = require('child_process');
const PORT = 4511, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const EMAIL = `ada${ID}@x.com`, PW = 'password123';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
(async () => {
  const fs = require('fs'); const DATA = `${ROOT}/app/server/data`;
  for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
    stdio: ['ignore','ignore','inherit'],
  });
  for (;;) { try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch {} await new Promise(r=>setTimeout(r,200)); }
  let cookie = '';
  const call = async (m,p,b) => {
    const r = await fetch(`${BASE}/api${p}`, { method:m, headers:{'content-type':'application/json',...(cookie?{cookie}:{})}, body:b===undefined?undefined:JSON.stringify(b) });
    const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0];
    return { s: r.status, d: await r.json().catch(()=>null) };
  };
  await call('POST','/auth/signup',{name:'Ada',email:EMAIL,password:PW,accountCategory:'principal'});
  await call('POST','/profile/onboarding-step',{step:'done'});

  const setup = await call('POST','/security/2fa/setup');
  ok('setup starts and hands back a secret', setup.s === 200 && !!setup.d.secret);

  // Walk away without confirming — exactly what happens if you open the screen,
  // look at the QR code, and close the tab.
  const login = await fetch(`${BASE}/api/auth/login`, { method:'POST',
    headers:{'content-type':'application/json'}, body: JSON.stringify({ email: EMAIL, password: PW }) });
  ok('an unconfirmed enrolment does NOT start demanding codes', login.status === 200, String(login.status));

  const started = await call('POST','/security/2fa/setup');
  ok('and starting again is clean rather than piling up rows', started.s === 200);

  const state = await call('GET','/security');
  ok('the screen still reports two-factor as off', state.d.twoFactor?.enabled === false, JSON.stringify(state.d.twoFactor));

  proc.kill();
  console.log(fails === 0 ? '\nOnly a completed setup can ask for a code.' : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
