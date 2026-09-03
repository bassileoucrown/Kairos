// Reaching a phone that is in a pocket.
//
// WHAT MAKES THIS SUITE NECESSARY. Push is the one feature in Kairos whose
// failure is completely silent. There is no error, no bounce, no red banner:
// a mis-derived key or a wrong info string produces a body the browser cannot
// open, the push service accepts it happily, and nothing arrives — which from
// inside the app is indistinguishable from a quiet afternoon. Nobody would
// notice for weeks.
//
// So the encryption is proved the only way it honestly can be without owning a
// phone: this suite plays the browser. It generates the keypair a browser would
// generate, hands Kairos the public half exactly as a subscription does, and
// then opens the sealed record with the private half. If a single byte of the
// key agreement, the HKDF chain or the record framing is wrong, the decryption
// fails and this goes red — which is what a real device would do, silently.
//
// The rest is the surface around it: who may subscribe, what happens when the
// same browser subscribes twice, and that a deployment with no keys says so
// rather than pretending.
const ROOT = require('path').join(__dirname, '..', '..');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4573, BASE = `http://127.0.0.1:${PORT}`, ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** The pair a deployment is given, made the way the Security screen makes it. */
function vapidPair() {
  const ec = crypto.createECDH('prime256v1');
  ec.generateKeys();
  return { publicKey: b64url(ec.getPublicKey()), privateKey: b64url(ec.getPrivateKey()) };
}

/**
 * The browser's half of a subscription.
 *
 * A P-256 keypair it generated and sixteen bytes of salt. Kairos is given the
 * public key and the salt and nothing else, which is exactly why it cannot read
 * what it sends.
 */
function browserKeys() {
  const ec = crypto.createECDH('prime256v1');
  ec.generateKeys();
  return { ec, p256dh: b64url(ec.getPublicKey()), auth: b64url(crypto.randomBytes(16)) };
}

const hkdf = (salt, ikm, info, len) => {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto.createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
};

/** What the browser does with what arrives. RFC 8188 framing, RFC 8291 keys. */
function openSealed(record, browser) {
  const salt = record.subarray(0, 16);
  const idlen = record[20];
  const asPublic = record.subarray(21, 21 + idlen);
  const sealed = record.subarray(21 + idlen);

  const shared = browser.ec.computeSecret(asPublic);
  const ikm = hkdf(
    unb64url(browser.auth),
    shared,
    Buffer.concat([
      Buffer.from('WebPush: info\0', 'utf8'),
      unb64url(browser.p256dh),
      asPublic,
    ]),
    32,
  );
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  const tag = sealed.subarray(sealed.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - 16)),
    decipher.final(),
  ]);
  // The trailing byte is the standard's last-record marker, not content.
  return { text: plain.subarray(0, plain.length - 1).toString('utf8'), delimiter: plain[plain.length - 1] };
}

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

(async () => {
  const pair = vapidPair();

  // ---- The crypto, in this process --------------------------------------
  //
  // Before any server: these are pure functions, and a failure here explains
  // every failure that would follow.
  head('Sealing a notification to one browser:');
  process.env.VAPID_PUBLIC_KEY = pair.publicKey;
  process.env.VAPID_PRIVATE_KEY = pair.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:ops@kairos.test';
  const webPush = require(`${ROOT}/app/server/lib/webPush`);

  ok('a generated pair is recognised as configured', webPush.isConfigured());
  ok('and has nothing to complain about', webPush.problem() === null, String(webPush.problem()));

  const browser = browserKeys();
  const payload = JSON.stringify({ title: 'Adaeze · Direct line', body: 'Sent you a message.', url: '/threads/x' });
  const record = webPush.seal(payload, browser.p256dh, browser.auth);

  // THE ASSERTION THE WHOLE SUITE EXISTS FOR.
  let opened = null;
  try { opened = openSealed(record, browser); } catch (e) { opened = { error: e.message }; }
  ok('the browser can open what Kairos sealed', opened?.text === payload,
    opened?.error || String(opened?.text).slice(0, 80));
  ok('and the record ends with the standard\'s last-record marker', opened?.delimiter === 2,
    String(opened?.delimiter));

  // Nothing readable travels in the clear. A push passes through Google's or
  // Apple's servers, and the whole point of the encryption is that they carry
  // it without being able to read it.
  ok('none of the text is visible in what goes on the wire',
    !record.toString('latin1').includes('Direct line'));

  // A fresh ephemeral key per message, so yesterday's push cannot be reopened
  // even by the deployment that sent it.
  const again = webPush.seal(payload, browser.p256dh, browser.auth);
  ok('two sealings of the same words share no bytes of key material',
    !record.subarray(21, 86).equals(again.subarray(21, 86)));

  head('Signing, so a push service will carry it:');
  const authHeader = webPush.authorizationFor('https://fcm.googleapis.com/fcm/send/abc');
  const token = authHeader.match(/t=([^,]+)/)?.[1] || '';
  const [h, c, sig] = token.split('.');
  ok('the header names this deployment\'s public key',
    authHeader.includes(`k=${pair.publicKey}`), authHeader.slice(0, 60));
  const claims = JSON.parse(unb64url(c).toString());
  ok('addressed to the push service, not to one device',
    claims.aud === 'https://fcm.googleapis.com', claims.aud);
  ok('carrying somewhere to complain to', claims.sub === 'mailto:ops@kairos.test');
  ok('and expiring, so a leaked token is not forever', claims.exp > Math.floor(Date.now() / 1000));

  // Verified against the PUBLIC half, which is the only proof that the two
  // halves in the environment actually belong together.
  const verifier = crypto.createPublicKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64url(unb64url(pair.publicKey).subarray(1, 33)),
      y: b64url(unb64url(pair.publicKey).subarray(33, 65)),
    },
    format: 'jwk',
  });
  ok('the signature verifies against the public key',
    crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: verifier, dsaEncoding: 'ieee-p1363' },
      unb64url(sig)));

  head('Halves that do not belong together:');
  // Two keys from two different generations pass every length check, sign
  // perfectly, and are rejected by every push service — with no error anywhere
  // near the cause. Caught here instead.
  const stranger = vapidPair();
  process.env.VAPID_PUBLIC_KEY = stranger.publicKey;
  ok('are named as a mismatched pair rather than accepted',
    /not two halves of the same pair/.test(webPush.problem() || ''), String(webPush.problem()));
  process.env.VAPID_PUBLIC_KEY = pair.publicKey;
  ok('and putting the right half back clears it', webPush.problem() === null);

  ok('a payload too large for one record is refused rather than truncated',
    (await webPush.sendTo(
      { endpoint: 'https://example.test/x', p256dh: browser.p256dh, auth: browser.auth },
      'x'.repeat(webPush.MAX_PLAINTEXT + 1),
    )).error === 'payload too large');

  // ---- The surface, against a running server ----------------------------
  const fs = require('fs');
  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      ENCRYPTION_KEY: KEY,
      VAPID_PUBLIC_KEY: pair.publicKey,
      VAPID_PRIVATE_KEY: pair.privateKey,
      VAPID_SUBJECT: 'mailto:ops@kairos.test',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  let browserUI = null;
  try {
    for (;;) {
      try { if ((await (await fetch(`${BASE}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const boss = client();
    await boss('POST', '/auth/signup',
      { name: 'Adaeze Okonkwo', email: `ada${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await boss('PATCH', '/profile', { slug: `h${ID}-1` });
    await boss('POST', '/profile/onboarding-step', { step: 'done' });

    head('What a browser is told before it can subscribe:');
    const config = await boss('GET', '/push/config');
    ok('the deployment says it can reach a phone', config.d.configured === true, JSON.stringify(config.d));
    ok('and hands over the public key', config.d.publicKey === pair.publicKey);
    // The property that makes VAPID worth anything at all.
    ok('and NEVER the private one',
      !JSON.stringify(config.d).includes(pair.privateKey));
    ok('with no devices yet', config.d.devices.length === 0);

    head('Granting on a device:');
    const endpoint = `https://fcm.googleapis.com/fcm/send/${ID}-phone`;
    const sub = await boss('POST', '/push/subscribe',
      { endpoint, keys: { p256dh: browser.p256dh, auth: browser.auth } });
    ok('records the subscription', sub.s === 201, JSON.stringify(sub.d));
    ok('and it shows as a device', (await boss('GET', '/push/config')).d.devices.length === 1);

    // A browser hands back the SAME endpoint every time it is asked, and people
    // re-grant after clearing data or reinstalling. Two rows would push to one
    // phone twice.
    await boss('POST', '/push/subscribe',
      { endpoint, keys: { p256dh: browser.p256dh, auth: browser.auth } });
    ok('granting again on the same device updates rather than duplicates',
      (await boss('GET', '/push/config')).d.devices.length === 1);

    const second = browserKeys();
    await boss('POST', '/push/subscribe',
      { endpoint: `${endpoint}-laptop`, keys: { p256dh: second.p256dh, auth: second.auth } });
    ok('a second device is its own subscription, because both should ring',
      (await boss('GET', '/push/config')).d.devices.length === 2);

    head('What is refused:');
    ok('half a subscription',
      (await boss('POST', '/push/subscribe', { endpoint })).s === 400);
    ok('an endpoint that is not https, which is either a mistake or a trap',
      (await boss('POST', '/push/subscribe',
        { endpoint: 'http://127.0.0.1:9/x', keys: { p256dh: browser.p256dh, auth: browser.auth } })).s === 400);
    ok('and anybody who is not signed in',
      (await (client())('GET', '/push/config')).s === 401);

    head('Silencing one device:');
    const other = client();
    await other('POST', '/auth/signup',
      { name: 'Chidi Eze', email: `chidi${ID}@x.com`, password: PW, accountCategory: 'principal' });
    await other('PATCH', '/profile', { slug: `h${ID}-2` });
    await other('POST', '/profile/onboarding-step', { step: 'done' });
    await other('DELETE', '/push/subscribe', { endpoint });
    ok('cannot be done by somebody else who happens to know the endpoint',
      (await boss('GET', '/push/config')).d.devices.length === 2);

    await boss('DELETE', '/push/subscribe', { endpoint });
    ok('but can be done by whoever it belongs to',
      (await boss('GET', '/push/config')).d.devices.length === 1);

    head('The test alert, which exists because failure here is silent:');
    // The endpoint is a real-looking address that will not answer, so this
    // proves the interesting half: a push service that refuses does not throw,
    // does not 500, and does not undo anything.
    const rung = await boss('POST', '/push/test');
    ok('answers rather than throwing when the push service will not play',
      rung.s === 200, JSON.stringify(rung.d));
    ok('and says how many devices were actually reached', typeof rung.d.sent === 'number');

    head('A message on the direct line, with push in the way:');
    // The point is not that a notification arrives — there is no phone here —
    // but that a failing push service cannot break sending a message. This is
    // the regression that would matter most: an office unable to talk because
    // Google is having an afternoon.
    const pa = client();
    await pa('POST', '/auth/signup',
      { name: 'Ngozi Bello', email: `ngozi${ID}@x.com`, password: PW, accountCategory: 'pa' });
    await pa('PATCH', '/profile', { slug: `h${ID}-3` });
    await pa('POST', '/profile/onboarding-step', { step: 'done' });
    const invite = await boss('POST', '/members', { email: `ngozi${ID}@x.com`, role: 'pa' });
    await pa('POST', `/invites/${invite.d.inviteLink.split('/').pop()}/accept`);
    const me = await boss('GET', '/auth/me');
    const today = await boss('GET', `/today/${me.d.user.id}`);
    const threadId = today.d.directLine.threadId;

    // The assistant is subscribed to an endpoint that will refuse everything.
    await pa('POST', '/push/subscribe',
      { endpoint: `https://fcm.googleapis.com/fcm/send/${ID}-dead`,
        keys: { p256dh: second.p256dh, auth: second.auth } });

    const sent = await boss('POST', `/threads/${threadId}/messages`, { body: "Car's outside." });
    ok('the message still lands', sent.s === 201, JSON.stringify(sent.d));
    ok('and is readable', (await pa('GET', `/threads/${threadId}/messages`))
      .d.messages.some((m) => m.body === "Car's outside."));

    // ---- The screen somebody actually goes looking for -------------------
    //
    // WHY THIS IS HERE. Everything above proves Kairos can reach a pocket. It
    // proves nothing about whether a person can FIND the switch — and the card
    // used to return null whenever the browser reported no support, so
    // somebody who had set the keys, installed the app and gone looking for
    // notifications found an empty space where the setting should be. Nothing
    // distinguishes that from a feature that was never built.
    //
    // Worse, the early return sat in front of the iOS explanation: Safari in a
    // tab has no Notification object at all, so the words written for exactly
    // those people could never be reached by them.
    head('The notifications setting is findable, whatever the browser can do:');
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `ada${ID}@x.com`, password: PW }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    browserUI = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const ctx = await browserUI.newContext({ viewport: { width: 390, height: 844 } });
    const [ck, cv] = cookie.split('=');
    await ctx.addCookies([{ name: ck, value: cv, domain: '127.0.0.1', path: '/' }]);

    const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard?tab=settings`);
    await page.waitForSelector('.card', { timeout: 20000 });
    const settings = await page.locator('body').innerText();
    // The word people search a settings screen for. "Alerts" is accurate and
    // is not what anybody scans for.
    ok('the card is on the settings screen, by the name people look for',
      /Notifications on this device/.test(settings), settings.slice(0, 300));
    // Three conditions have to be true and only one of them is the browser's.
    // "Notifications are off" is a useless answer; which one is missing is not.
    ok('and says which of the conditions is not met yet',
      /Keys set on this deployment/.test(settings)
      && /Opened from the installed app/.test(settings)
      && /allowed to notify/.test(settings), settings.slice(0, 400));

    // THE REGRESSION THIS EXISTS FOR. A browser with no Push API is exactly
    // what an iPhone looks like before the app is on the home screen.
    const blind = await ctx.newPage();
    await blind.addInitScript(() => {
      delete window.PushManager;
      delete window.Notification;
    });
    await blind.goto(`${BASE}/dashboard?tab=settings`);
    await blind.waitForSelector('.card', { timeout: 20000 });
    const blindText = await blind.locator('body').innerText();
    ok('a browser that cannot do it still SEES the setting rather than a gap',
      /Notifications on this device/.test(blindText), blindText.slice(0, 300));
    ok('and is told why, instead of being left to guess',
      /cannot receive notifications/.test(blindText), blindText.slice(0, 400));
    ok('and is told it is not their account that is wrong',
      /Nothing is wrong with your account/.test(blindText));
  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browserUI) await browserUI.close().catch(() => {});
    proc.kill();
  }

  console.log(fails === 0
    ? '\nKairos can reach a pocket, and cannot read what it sends.'
    : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
