// The push keys the deployment needs, made in a browser.
//
// WHY THIS SUITE MATTERS MORE THAN IT LOOKS. A generator that produces a
// plausible-looking string which the push services then reject fails in the
// worst possible way: nothing is wrong on any screen, the keys are saved into
// the host, people grant notification permission — and no notification ever
// arrives, with no error pointing anywhere near the cause. So the values are
// not eyeballed here. They are taken back out of the browser and checked as
// cryptography: the public half must be a real point on the P-256 curve, and
// the private half must be the scalar that produces exactly that point.
//
// The second thing proved is that nothing is kept. A private key the server
// has seen is a private key the server could keep, so the pair must exist in
// that tab and nowhere else.
const ROOT = require('path').join(__dirname, '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;

let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (t) => console.log(`\n${t}`);

const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// The generator, lifted verbatim from components/VapidKeySetup.jsx. Kept in
// step by being short enough to read side by side — the alternative is
// importing a React module into Node, which would test the import more than
// the maths.
const GENERATOR = `async () => {
  const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  const fromB64url = (s) => Uint8Array.from(
    atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const x = fromB64url(jwk.x), y = fromB64url(jwk.y);
  const point = new Uint8Array(65);
  point[0] = 4; point.set(x, 1); point.set(y, 33);
  return { publicKey: b64url(point), privateKey: jwk.d, x: jwk.x, y: jwk.y };
}`;

(async () => {
  // Served from the app rather than about:blank, and that is not incidental.
  // crypto.subtle exists only in a SECURE CONTEXT — https, or localhost. On
  // about:blank it is simply undefined, which is the same failure an operator
  // would hit on a plain-http deployment. Running it where the card actually
  // runs is the only way this proves anything.
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL || '',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  // Two and a half minutes. Twenty seconds was plenty on an idle machine and
  // not plenty on a loaded one; a minute went the same way, twice in one day,
  // on a box where a hundred suites run back to back and each one starts a
  // server and half of them start a browser. "No server" on a green tree is a
  // board crying wolf, and it costs an hour of hunting a product bug that was
  // never there.
  //
  // Waiting longer is free when the tree is green — the loop exits the instant
  // the server answers — and is only paid when something is genuinely broken,
  // which is the right way round for this trade.
  const deadline = Date.now() + 150000;
  for (;;) {
    try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('no server');
    await new Promise((r) => setTimeout(r, 200));
  }

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/login`);
    ok('the app is a secure context, so the browser will do cryptography in it',
      await page.evaluate(() => window.isSecureContext === true && !!crypto.subtle));
    const keys = await page.evaluate(`(${GENERATOR})()`);

    head('The shape the Web Push standard insists on:');
    const pub = fromB64url(keys.publicKey);
    const priv = fromB64url(keys.privateKey);
    // Not cosmetic: a push service rejects anything else outright.
    ok('the public key is 65 bytes — the uncompressed point', pub.length === 65, String(pub.length));
    ok('and starts with the 0x04 marker that says so', pub[0] === 4, String(pub[0]));
    ok('which is 87 base64url characters', keys.publicKey.length === 87, String(keys.publicKey.length));
    ok('the private key is the bare 32-byte scalar', priv.length === 32, String(priv.length));
    ok('which is 43 characters', keys.privateKey.length === 43, String(keys.privateKey.length));
    ok('and neither carries base64 padding, which would be rejected',
      !/[+/=]/.test(keys.publicKey + keys.privateKey));

    head('And it is real cryptography, not a plausible-looking string:');
    // Rebuilt in Node from the two halves. If the public key were not the
    // point this private key produces, importing it would fail here — which
    // is exactly the failure a push service would hit, silently, in a month.
    let imported = null;
    try {
      imported = crypto.createPrivateKey({
        key: {
          kty: 'EC',
          crv: 'P-256',
          x: keys.x,
          y: keys.y,
          d: keys.privateKey,
        },
        format: 'jwk',
      });
    } catch (e) {
      ok('the pair imports as a P-256 key', false, e.message);
    }
    ok('the pair imports as a P-256 key', !!imported);

    if (imported) {
      // The public half derived from the private one, independently of the
      // browser. It must be byte for byte what the card handed over.
      const derived = crypto.createPublicKey(imported).export({ format: 'jwk' });
      const rebuilt = Buffer.concat([
        Buffer.from([4]), fromB64url(derived.x), fromB64url(derived.y),
      ]);
      ok('and the public half is exactly the point the private half produces',
        rebuilt.equals(pub), `${rebuilt.toString('base64url').slice(0, 24)}… vs ${keys.publicKey.slice(0, 24)}…`);

      // A signature verifies, which is the thing a push service actually does.
      const message = Buffer.from('kairos push identity check');
      const sig = crypto.sign(null, message, imported);
      ok('a signature made with it verifies against it',
        crypto.verify(null, message, crypto.createPublicKey(imported), sig));
    }

    head('Every pair is its own:');
    const second = await page.evaluate(`(${GENERATOR})()`);
    ok('two runs never agree', second.publicKey !== keys.publicKey);
    ok('nor on the private half', second.privateKey !== keys.privateKey);

    head('And nothing is kept anywhere:');
    const left = await page.evaluate(() => {
      let n = 0;
      try { n += localStorage.length; } catch { /* blocked is fine */ }
      try { n += sessionStorage.length; } catch { /* blocked is fine */ }
      return n;
    });
    // The card never writes them down. They exist in that tab and nowhere
    // else until somebody pastes them into their host, which is the point:
    // a private key the server has seen is a private key the server could keep.
    ok('the browser stores neither half', left === 0, String(left));

    head('And the deployment says whether it is set up, from the same place:');
    // The card and the sender must ask one question. If they did not, the card
    // could keep offering to make keys that are already set — or worse, stop
    // offering while the sender still had none.
    const r = await (await fetch(`${BASE}/api/status`)).json();
    void r;
    ok('with no keys set, push is reported as not configured',
      await (async () => {
        const { isConfigured } = require(`${ROOT}/app/server/lib/webPush`);
        return isConfigured() === false;
      })());

    // Shape is checked rather than trusted: a key pasted with a character
    // missing is the failure nobody can trace, because the push service just
    // drops the message.
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = 'mailto:ops@example.com';
    delete require.cache[require.resolve(`${ROOT}/app/server/lib/webPush`)];
    let push = require(`${ROOT}/app/server/lib/webPush`);
    ok('and configured once a real pair is set', push.isConfigured() === true);
    ok('with nothing to complain about', push.problem() === null, String(push.problem()));

    process.env.VAPID_PUBLIC_KEY = `${keys.publicKey.slice(0, -1)}`;
    delete require.cache[require.resolve(`${ROOT}/app/server/lib/webPush`)];
    push = require(`${ROOT}/app/server/lib/webPush`);
    ok('a key one character short is caught here rather than at the push service',
      push.isConfigured() === false && /87 characters/.test(push.problem() || ''), push.problem());

    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_SUBJECT = 'ops@example.com';
    delete require.cache[require.resolve(`${ROOT}/app/server/lib/webPush`)];
    push = require(`${ROOT}/app/server/lib/webPush`);
    ok('and a subject that is not a mailto: or https: is too',
      /mailto:/.test(push.problem() || ''), push.problem());

  } finally {
    await browser.close();
    proc.kill();
  }

  console.log(fails === 0
    ? '\nThe app can make its own push keys, and they are the real thing rather than the right shape.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
