// A contact sheet: all fourteen daily posts on one page, for approval.
//
// SELF-CONTAINED ON PURPOSE. Every image is a data URI, so the page fetches
// nothing when it is opened and works from a Downloads folder with no network
// — the same reason the tester agreement and the orientation are built this
// way. Published pages have never opened on the owner's machine; files have,
// first time.
//
// The posts are downscaled here rather than embedded whole. Fourteen full
// 2160×2700 PNGs come to 4.7MB, which as base64 is a 6MB page to scroll for a
// yes or a no; the JPEGs below are for looking at, and the PNGs beside them
// are what actually gets posted.

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core'));

const DAILY = path.resolve(process.argv[2] || path.join(__dirname, 'daily'));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, 'daily-contact-sheet.html'));

// Kept beside the generator rather than parsed back out of it: these are the
// captions a person posts, and they want editing without touching code.
const CAPTIONS = require('./captions.json');

(async () => {
  const files = fs.readdirSync(DAILY).filter((f) => f.endsWith('.png')).sort();
  if (!files.length) throw new Error(`no posts in ${DAILY} — run phones.js first`);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await (await browser.newContext()).newPage();
  await p.goto('about:blank');

  const cards = [];
  for (const f of files) {
    const b64 = fs.readFileSync(path.join(DAILY, f)).toString('base64');
    const small = await p.evaluate(async (src) => {
      const im = new Image();
      await new Promise((ok, no) => { im.onload = ok; im.onerror = no; im.src = src; });
      const w = 460, h = Math.round((im.naturalHeight / im.naturalWidth) * w);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(im, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.84);
    }, `data:image/png;base64,${b64}`);

    const key = f.replace(/\.png$/, '');
    const cap = CAPTIONS[key] || {};
    cards.push(`<figure>
      <img src="${small}" alt="${key}">
      <figcaption>
        <b>${f}</b>
        <p class="cap">${(cap.caption || '').replace(/\n/g, '<br>')}</p>
        ${cap.tags ? `<p class="tags">${cap.tags}</p>` : ''}
      </figcaption>
    </figure>`);
  }
  await browser.close();

  fs.writeFileSync(OUT, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Kairos by Exousia — daily posts</title>
<style>
  :root{--paper:#FAF9F6;--ink:#1C2127;--muted:#6B6659;--gold:#8A6A24;--line:#E3E0D6}
  *{box-sizing:border-box}
  body{margin:0;padding:40px 32px 80px;background:var(--paper);color:var(--ink);
    font:15px/1.5 'Liberation Sans',Arial,Helvetica,sans-serif}
  header{max-width:1180px;margin:0 auto 30px;border-bottom:2px solid #24372F;padding-bottom:16px}
  h1{font-family:'Bitstream Charter',Charter,Georgia,serif;font-size:34px;margin:0 0 6px}
  h1 i{font-style:normal;color:var(--gold)}
  header p{margin:0;color:var(--muted);max-width:72ch}
  .grid{max-width:1180px;margin:0 auto;display:grid;
    grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:34px 28px}
  figure{margin:0}
  figure img{width:100%;display:block;border:1px solid var(--line);border-radius:6px}
  figcaption{padding-top:10px}
  figcaption b{font-size:13px;letter-spacing:.4px;color:var(--gold)}
  .cap{margin:6px 0 0;white-space:normal}
  .tags{margin:6px 0 0;color:var(--muted);font-size:13px}
  footer{max-width:1180px;margin:44px auto 0;border-top:1px solid var(--line);
    padding-top:14px;color:var(--muted);font-size:13px}
</style></head><body>
<header>
  <h1>Kairos <i>by Exousia</i> — daily posts</h1>
  <p>Fourteen posts, one a day. Every phone holds a real screenshot of the running
  app, not a drawing. 1080 × 1350 at 2×. The caption under each is the text to
  post with it.</p>
</header>
<div class="grid">${cards.join('\n')}</div>
<footer>Generated from docs/marketing/phones.js · screenshots from docs/marketing/screens.js</footer>
</body></html>`);

  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`${cards.length} posts on the sheet · ${OUT} · ${kb}KB`);
})();
