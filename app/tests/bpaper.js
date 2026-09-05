// A document goes in, and what it is decides who can take it out.
//
// Until now the only bytes Kairos accepted were audio. A document is a
// different problem, because a document is a thing one person hands another:
// it is stored, and later it is served back. Three claims carry the feature,
// and this suite exists for them.
//
//   THE NAME IS NOT THE FILE. Both the extension and the declared type are
//   typed by whoever is uploading. A .pdf that starts with PK is not a
//   mislabelled PDF, it is a zip somebody renamed, and the whole point of
//   reading the bytes is that guessing which was meant turns the check into
//   decoration. Macro-carrying Office files are the sharp end of this: .docx
//   and .docm are the same container with the same first four bytes.
//
//   IT LEAVES THIS PROCESS SEALED. What the bucket receives is not the
//   document. Proved by decrypting what the fake store actually got, rather
//   than by trusting that a call was made.
//
//   AND THE FLAG ONLY GOES UP. Every document is in the vault, so the entry it
//   hangs on has usually answered who may see it. The case worth catching is a
//   passport scan filed under an ordinary field — an office address — which a
//   scheduling delegate can read. That document must be stricter than the
//   field it is attached to, and the field's own ordinariness must survive for
//   everything else, or the rule is just "mark it all sensitive", which
//   teaches assistants that the marking means nothing.
const ROOT = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const PORT = 4671, BASE = `http://127.0.0.1:${PORT}`;
const BARE = 4672, BAREBASE = `http://127.0.0.1:${BARE}`;
const STORE_PORT = 4673;
const ID = Date.now().toString(36);
const PW = 'password123';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let fails = 0;
const ok = (l, c, x = '') => { if (!c) { fails++; console.log('  ✗ ' + l + (x ? ' — ' + x : '')); } else console.log('  ✓ ' + l); };
const head = (s) => console.log(`\n${s}`);

function client(base = BASE) {
  let cookie = '';
  return async function call(method, p, body, raw = false) {
    const r = await fetch(`${base}/api${p}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const t = await r.text();
    if (raw) return { s: r.status, t, h: r.headers, buf: Buffer.from(t, 'binary') };
    let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = { raw: t }; }
    return { s: r.status, d };
  };
}

/** An S3-compatible endpoint that keeps what it is given in memory. */
function fakeStore() {
  const objects = new Map();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const key = req.url;
      if (req.method === 'PUT') { objects.set(key, Buffer.concat(chunks)); res.writeHead(200); }
      else if (req.method === 'GET') {
        const v = objects.get(key);
        if (!v) { res.writeHead(404); res.end(); return; }
        res.writeHead(200); res.end(v); return;
      } else if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); }
      else res.writeHead(405);
      res.end();
    });
  });
  return { server, objects };
}

// ---- Files, made of the bytes that actually identify them ----------------
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(400, 0x20)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 3)]);
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(200, 1)]);
const ZIPHEAD = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DOCX = Buffer.concat([ZIPHEAD, Buffer.from('word/document.xml'), Buffer.alloc(300, 0)]);
const DOCM = Buffer.concat([ZIPHEAD, Buffer.from('word/vbaProject.bin'), Buffer.alloc(300, 0)]);
const TXT = Buffer.from('The car is downstairs at eight.\n');

const b64 = (buf) => buf.toString('base64');
const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

async function signUp(call, name, email, category, handle) {
  await call('POST', '/auth/signup', { name, email, password: PW, accountCategory: category });
  await call('PATCH', '/profile', { slug: handle });
  await call('POST', '/profile/onboarding-step', { step: 'done' });
  return (await call('GET', '/auth/me')).d.user;
}

(async () => {
  // The suite decrypts what the store received, to prove the document left the
  // server already sealed. secretBox reads the key when it loads, and only the
  // SPAWNED server was given one — so this process needs the same key set
  // before anything requires it, or the check measures the test's environment
  // rather than the product's behaviour.
  process.env.ENCRYPTION_KEY = KEY;

  const DATA = `${ROOT}/app/server/data`;
  if (!process.env.DATABASE_URL) {
    for (const f of fs.existsSync(DATA) ? fs.readdirSync(DATA) : []) {
      if (f.startsWith('kairos.sqlite')) fs.rmSync(`${DATA}/${f}`);
    }
  }

  const store = fakeStore();
  await new Promise((r) => store.server.listen(STORE_PORT, '127.0.0.1', r));

  const storeEnv = {
    STORAGE_BUCKET: 'kairos-test',
    STORAGE_ENDPOINT: `http://127.0.0.1:${STORE_PORT}`,
    STORAGE_REGION: 'us-east-1',
    STORAGE_KEY: 'AKIAIOSFODNN7EXAMPLE',
    STORAGE_SECRET: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  };
  const proc = spawn('node', ['--experimental-sqlite', 'index.js'], {
    cwd: `${ROOT}/app/server`,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ENCRYPTION_KEY: KEY, ...storeEnv },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // The same build with no bucket, to prove the feature says so rather than
  // half-working.
  //
  // STARTED SECOND, AND ONLY ONCE THE FIRST IS UP. Both of them build the
  // schema, and on SQLite they are building it in the same file — two
  // processes doing that at the same moment is a lock, which surfaces as "the
  // database is locked" and a suite that waits thirty seconds for a retry it
  // did not need. Serialising costs a second and removes the contention.
  let bare = null;
  let browser = null;
  const ready = async (base) => {
    const deadline = Date.now() + 150000;
    for (;;) {
      try { if ((await (await fetch(`${base}/api/status`)).json()).databaseReady) break; }
      catch { /* not up */ }
      if (Date.now() > deadline) throw new Error(`no server on ${base}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  try {
    await ready(BASE);
    bare = spawn('node', ['--experimental-sqlite', 'index.js'], {
      cwd: `${ROOT}/app/server`,
      env: {
        ...process.env, NODE_ENV: 'production', PORT: String(BARE), ENCRYPTION_KEY: KEY,
        STORAGE_BUCKET: '', STORAGE_ENDPOINT: '', STORAGE_KEY: '', STORAGE_SECRET: '',
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    await ready(BAREBASE);

    const boss = client();
    const me = await signUp(boss, 'Adaeze Okonkwo', `ada${ID}@x.com`, 'principal', `ada-${ID}`);

    // A scheduling delegate: reads ordinary fields, never sensitive ones.
    const del = client();
    await signUp(del, 'Chidi Umeh', `chidi${ID}@x.com`, 'pa', `chidi-${ID}`);
    let r = await boss('POST', '/members', { email: `chidi${ID}@x.com`, role: 'delegate' });
    await del('POST', `/invites/${String(r.d.inviteLink).split('/').pop()}/accept`);

    // Two entries: one sensitive by its own category, one ordinary.
    const passport = (await boss('POST', `/essentials/${me.id}`, {
      category: 'travel_identity', field: 'passport_number',
      label: 'Passport', value: 'A05512347',
    })).d.essential;
    const office = (await boss('POST', `/essentials/${me.id}`, {
      category: 'logistics', field: 'office_address',
      label: 'Office address', value: '12 Kingsway Road, Ikoyi',
    })).d.essential;
    ok('the vault holds a sensitive entry and an ordinary one',
      passport?.sensitivity === 'sensitive' && office?.sensitivity === 'ordinary',
      `${passport?.sensitivity} / ${office?.sensitivity}`);

    // ---- What Kairos says it takes ---------------------------------------
    head('The accepted formats are published rather than discovered by failing:');
    r = await boss('GET', '/essentials/formats');
    const ids = (r.d.accepted || []).map((f) => f.id);
    ok('the list is served', r.s === 200 && ids.length > 0, `${r.s} ${JSON.stringify(ids)}`);
    ok('Word is among them', ids.includes('docx'), JSON.stringify(ids));
    ok('with PDF and photographs, which is what a passport arrives as',
      ['pdf', 'jpeg', 'png', 'heic'].every((x) => ids.includes(x)), JSON.stringify(ids));
    // The refusals are published too, so a screen can say what will not go in
    // before somebody spends a minute choosing it.
    const refusedExts = (r.d.refused || []).flatMap((x) => x.extensions);
    ok('and the refusals are published beside them',
      ['.doc', '.docm', '.zip', '.svg', '.exe'].every((x) => refusedExts.includes(x)),
      JSON.stringify(refusedExts));
    ok('every refusal says why in a sentence',
      (r.d.refused || []).every((x) => (x.why || '').length > 30),
      JSON.stringify((r.d.refused || []).map((x) => x.why)));
    ok('the cap is stated', r.d.maxBytes === 15 * 1024 * 1024, String(r.d.maxBytes));

    // ---- What goes in ----------------------------------------------------
    head('A document goes in:');
    const put = (essId, filename, buf, mimeType) => boss(
      'POST', `/essentials/${me.id}/${essId}/documents`,
      { filename, mimeType, data: b64(buf) },
    );

    r = await put(passport.id, 'passport-page.pdf', PDF, 'application/pdf');
    ok('a PDF is taken', r.s === 201, `${r.s} ${r.d?.error || ''}`);
    const pdfDoc = r.d.document;
    ok('and it is filed as sensitive, because the field is',
      pdfDoc.sensitivity === 'sensitive', pdfDoc.sensitivity);
    ok('with its size and name kept', pdfDoc.bytes === PDF.length
      && pdfDoc.filename === 'passport-page.pdf', JSON.stringify(pdfDoc));

    r = await put(passport.id, 'letter.docx', DOCX, MIME.docx);
    ok('a Word document is taken', r.s === 201, `${r.s} ${r.d?.error || ''}`);
    ok('and named as one on the screen', r.d.document?.formatLabel === 'Word document',
      r.d.document?.formatLabel);
    const wordDoc = r.d.document;

    for (const [what, name, buf, mime] of [
      ['a photograph', 'page.jpg', JPEG, 'image/jpeg'],
      ['a screenshot', 'page.png', PNG, 'image/png'],
      ['an iPhone photograph', 'page.heic', HEIC, 'image/heic'],
      ['a plain note', 'note.txt', TXT, 'text/plain'],
    ]) {
      r = await put(passport.id, name, buf, mime);
      ok(`${what} is taken`, r.s === 201, `${r.s} ${r.d?.error || ''}`);
    }

    // ---- What does not, and why ------------------------------------------
    head('And what does not go in says why, rather than "unsupported":');
    const refuse = async (label, name, buf, mime, expect) => {
      const bad = await put(passport.id, name, buf, mime);
      ok(label, bad.s === 400 && expect.test(bad.d?.error || ''),
        `${bad.s} ${bad.d?.error || ''}`);
    };
    await refuse('a .doc is refused and points at .docx',
      'old.doc', DOCX, 'application/msword', /macros.*\.docx|\.docx/i);
    await refuse('a macro-carrying .docm is refused by name',
      'macro.docm', DOCM, MIME.docx, /macro/i);
    await refuse('an archive is refused', 'papers.zip', DOCX, 'application/zip', /archive/i);
    await refuse('a web document is refused', 'page.svg', TXT, 'image/svg+xml', /run code|PDF/i);
    await refuse('a program is refused', 'run.exe', TXT, '', /program/i);
    await refuse('a format nobody named is refused and the list is said',
      'thing.xyz', TXT, '', /does not take \.xyz/i);
    await refuse('a file with no extension at all is refused',
      'scan', PDF, 'application/pdf', /name with its type/i);

    // THE ONE THAT MATTERS. Renaming is the whole attack.
    await refuse('a zip renamed .pdf is caught by its own bytes',
      'invoice.pdf', DOCX, 'application/pdf', /named \.pdf but is not one/i);
    await refuse('and a .docm renamed .docx is caught by the macro project inside it',
      'letter.docx', DOCM, MIME.docx, /macro/i);
    await refuse('a name and a declared type that disagree are refused',
      'letter.docx', DOCX, 'image/jpeg', /sent as JPEG/i);
    await refuse('an empty file is refused', 'empty.pdf', Buffer.alloc(0), 'application/pdf',
      /empty/i);
    const huge = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(16 * 1024 * 1024, 0x20)]);
    await refuse('and one over the cap is refused with the cap said',
      'big.pdf', huge, 'application/pdf', /at most 15 MB/i);

    // ---- It leaves sealed -------------------------------------------------
    head('What the bucket receives is not the document:');
    const stored = [...store.objects.entries()].find(([k]) => k.includes(pdfDoc.id));
    ok('the store was actually written to', !!stored, JSON.stringify([...store.objects.keys()]));
    ok('and what it holds is not the file', !stored[1].includes(Buffer.from('%PDF-1.4')),
      stored[1].subarray(0, 24).toString('latin1'));
    const secretBox = require(`${ROOT}/app/server/lib/secretBox`);
    const back = Buffer.from(secretBox.decrypt(stored[1].toString('utf8')) || '', 'base64');
    ok('though it decrypts to exactly the file', back.equals(PDF), `${back.length} bytes`);

    // ---- Taking it out ----------------------------------------------------
    head('Opening one costs what revealing a number costs:');
    r = await boss('POST', `/essentials/${me.id}/${passport.id}/documents/${pdfDoc.id}/open`, {});
    ok('opening without the second factor is refused', r.s === 401 || r.s === 403,
      `${r.s} ${JSON.stringify(r.d)}`);
    ok('and nothing is handed over on the way', !r.d?.ticket, JSON.stringify(r.d));

    r = await boss('POST', `/essentials/${me.id}/${passport.id}/documents/${pdfDoc.id}/open`,
      { password: PW });
    ok('with it, a pass comes back', r.s === 200 && !!r.d.ticket, `${r.s} ${JSON.stringify(r.d)}`);
    const ticket = r.d.ticket;

    const at = `/essentials/${me.id}/${passport.id}/documents/${pdfDoc.id}`;
    const good = await boss('GET', `${at}?ticket=${ticket}`, undefined, true);
    ok('the document itself comes back', good.s === 200, String(good.s));
    // A URL with a pass in it ends up in a history and a proxy log. Spending
    // it once is what makes that survivable.
    const again = await boss('GET', `${at}?ticket=${ticket}`, undefined, true);
    ok('and the same pass cannot be spent twice', again.s === 403, String(again.s));
    ok('as an attachment rather than something to render',
      /^attachment;/.test(good.h.get('content-disposition') || ''),
      good.h.get('content-disposition'));
    ok('with sniffing turned off', good.h.get('x-content-type-options') === 'nosniff',
      good.h.get('x-content-type-options'));
    ok('named after the file that went in',
      /passport-page\.pdf/.test(good.h.get('content-disposition') || ''),
      good.h.get('content-disposition'));

    r = await boss('GET', `${at}?ticket=made-up`, undefined, true);
    ok('and a made-up pass opens nothing', r.s === 403, String(r.s));

    head('And the opening is on the principal\'s own record:');
    const today = new Date().toISOString().slice(0, 10);
    r = await boss('GET', `/report/${me.id}?from=${today}&to=${today}`);
    const entries = r.d.accessTrail?.entries || [];
    ok('the trail says somebody opened it',
      entries.some((e) => e.action === 'reveal' && /passport/i.test(e.field || '')),
      JSON.stringify(entries.map((e) => `${e.action}:${e.field}`)).slice(0, 200));

    // ---- The flag ---------------------------------------------------------
    head('A passport filed under an ordinary field is still a passport:');
    r = await put(office.id, 'floor-plan.pdf', PDF, 'application/pdf');
    const ordinary = r.d.document;
    ok('an ordinary document on an ordinary field stays ordinary',
      ordinary?.sensitivity === 'ordinary', ordinary?.sensitivity);

    r = await put(office.id, 'passport-scan.pdf', PDF, 'application/pdf');
    const smuggled = r.d.document;
    ok('but one that is plainly an identity document is filed sensitive',
      smuggled?.sensitivity === 'sensitive', smuggled?.sensitivity);
    ok('and says so, so nobody is surprised by it',
      /sensitive/i.test(smuggled?.flagNote || ''), smuggled?.flagNote);

    // Contents, not only the name — for the formats whose text can be read.
    const withNumber = Buffer.from('Reference for the account: 22134567890\n');
    r = await put(office.id, 'reference.txt', withNumber, 'text/plain');
    ok('a note carrying an identity number is filed sensitive by its contents',
      r.d.document?.sensitivity === 'sensitive', r.d.document?.sensitivity);

    head('And the flag is the thing the delegate runs into:');
    r = await del('GET', `/essentials/${me.id}`);
    ok('a scheduling delegate sees the ordinary entry', r.s === 200
      && r.d.essentials.some((e) => e.id === office.id), `${r.s} ${r.d?.essentials?.length}`);
    // POSITIVE CONTROL: they really are reading this vault, so the absences
    // below are the flag rather than an empty response.
    const theirs = r.d.essentials.find((e) => e.id === office.id);
    ok('and the ordinary document on it', (theirs.documents || [])
      .some((d) => d.id === ordinary.id), JSON.stringify(theirs.documents));
    ok('but not the passport scan filed beside it',
      !(theirs.documents || []).some((d) => d.id === smuggled.id),
      JSON.stringify((theirs.documents || []).map((d) => d.filename)));
    ok('nor the sensitive entry at all',
      !r.d.essentials.some((e) => e.id === passport.id),
      JSON.stringify(r.d.essentials.map((e) => e.label)));

    r = await del('POST', `/essentials/${me.id}/${office.id}/documents/${smuggled.id}/open`,
      { password: PW });
    ok('and asking for it outright is a 404, not a refusal', r.s === 404,
      `${r.s} ${JSON.stringify(r.d)}`);

    // ---- Throwing one away ------------------------------------------------
    head('Removing one removes it:');
    r = await boss('DELETE', `/essentials/${me.id}/${passport.id}/documents/${wordDoc.id}`);
    ok('the principal can throw a document away', r.s === 204, String(r.s));
    ok('and the bytes go with the row',
      ![...store.objects.keys()].some((k) => k.includes(wordDoc.id)),
      JSON.stringify([...store.objects.keys()].filter((k) => k.includes(wordDoc.id))));

    // ---- Not configured ---------------------------------------------------
    head('A deployment with no bucket says so rather than half-working:');
    const bareBoss = client(BAREBASE);
    const bareMe = await signUp(bareBoss, 'Bola Ade', `bola${ID}@x.com`, 'principal', `bola-${ID}`);
    const bareEss = (await bareBoss('POST', `/essentials/${bareMe.id}`, {
      category: 'travel_identity', field: 'passport_number', label: 'Passport', value: 'B111',
    })).d.essential;
    r = await bareBoss('GET', '/essentials/formats');
    ok('the formats endpoint reports it unavailable', r.d.available === false, String(r.d.available));
    ok('and says what is missing in a sentence a person can act on',
      /encryption key|object storage/i.test(r.d.unavailable || ''), r.d.unavailable);
    r = await bareBoss('POST', `/essentials/${bareMe.id}/${bareEss.id}/documents`,
      { filename: 'a.pdf', mimeType: 'application/pdf', data: b64(PDF) });
    ok('and attaching refuses with 503 rather than pretending', r.s === 503,
      `${r.s} ${r.d?.error || ''}`);

    // ---- The screen -------------------------------------------------------
    //
    // Everything above would pass with no control anywhere in the client. This
    // half walks the vault the way a principal does.
    //
    // AND IT MEASURES THE COLUMN. The first version of this list was a third
    // flex child of the entry row rather than part of it, and a filename
    // claimed its content width — .ess-main yields, because it is allowed to,
    // and a passport number rendered one character per line down the page.
    // Both boards were green through all of it: nothing asserts on width, so
    // nothing noticed. A rendered box is the only thing that would have.
    head('The vault offers it, and the entry it belongs to is still readable:');
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1200 } }))
      .newPage();
    const threw = [];
    page.on('pageerror', (e) => threw.push(e.message));

    await page.goto(`${BASE}/login`);
    await page.fill('input[type=email]', `ada${ID}@x.com`);
    await page.fill('input[type=password]', PW);
    await page.click('button[type=submit]');
    await page.waitForSelector('nav', { timeout: 20000 });
    await page.goto(`${BASE}/dashboard?tab=essentials`);
    await page.waitForSelector('.ess-docs', { timeout: 20000 });

    ok('every entry offers the control, by name',
      (await page.locator('.ess-attach:has-text("Attach a document")').count()) >= 2,
      String(await page.locator('.ess-attach').count()));
    ok('and it is a real file picker rather than a placeholder',
      (await page.locator('.ess-attach input[type=file]').count()) >= 2
      && (await page.locator('.btn.is-soon:has-text("Attach")').count()) === 0,
      `${await page.locator('.ess-attach input[type=file]').count()} inputs, `
      + `${await page.locator('.btn.is-soon:has-text("Attach")').count()} placeholders`);
    ok('the accepted formats are named on the screen, not discovered by failing',
      /Word document/.test(await page.locator('.ess-uploads').innerText()),
      await page.locator('.ess-uploads').innerText());

    // THE COLLAPSED-COLUMN ASSERTION. A masked passport number is about
    // 90px wide; the broken version was under 20 and ran down the page.
    const box = await page.locator('.ess-value').first().boundingBox();
    ok('the entry\'s own value is not crushed into a column of single letters',
      box && box.width > 120, JSON.stringify(box));
    ok('and its height is one or two lines, not forty',
      box && box.height < 80, JSON.stringify(box));
    ok('with the page not running off the side',
      !(await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));

    // The flag, on the screen this time. TWO badges and not more: the two
    // documents the ratchet caught on an ordinary field, and nothing else. A
    // badge on every document in a vault of sensitive things would say nothing
    // at all, so "how many" is the assertion, not "at least one".
    const flagged = await page.locator('.ess-docs li', { has: page.locator('.pill.is-warn') })
      .allInnerTexts();
    ok('the badge is on the two documents that earned it and no others',
      flagged.length === 2, JSON.stringify(flagged));
    ok('the passport filed under the ordinary field',
      flagged.some((t) => /passport-scan\.pdf/.test(t)), JSON.stringify(flagged));
    ok('and the note whose contents gave it away',
      flagged.some((t) => /reference\.txt/.test(t)), JSON.stringify(flagged));
    // POSITIVE CONTROL: the ordinary document on that same entry is on the
    // screen and unbadged, so the two above are the ratchet rather than a
    // badge on everything.
    const plain = await page.locator('.ess-docs li', { hasText: 'floor-plan.pdf' }).innerText();
    ok('while the genuinely ordinary one beside them carries no badge',
      !/Sensitive/i.test(plain), plain);

    ok('nothing threw while the vault was on screen', threw.length === 0, JSON.stringify(threw));

  } catch (err) {
    fails++;
    console.log('  ✗ threw: ' + (err.stack || err.message));
  } finally {
    if (browser) await browser.close();
    proc.kill();
    if (bare) bare.kill();
    store.server.close();
  }

  console.log(fails === 0
    ? '\nA document is taken in for what it is, sealed before it leaves, and opened by whoever the vault says.'
    : `\n${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('\nFAILED: ' + e.message); process.exit(1); });
