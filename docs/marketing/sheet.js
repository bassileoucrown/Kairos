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
//
// THE THUMBNAILS ARE RENDERED AT TWICE THEIR DISPLAY SIZE. The first version
// wrote them at 460px and showed them at about 360, on a screen that is very
// likely 2×, so every one arrived softer than the post it stood for — and the
// posts were read as blurry when the posts are sharp. A contact sheet that
// makes the work look worse than it is has failed at its only job.

const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', 'node_modules', 'playwright-core'));

const DAILY = path.resolve(process.argv[2] || path.join(__dirname, 'daily'));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, 'daily-contact-sheet.html'));

// Kept beside the generator rather than parsed back out of it: these are the
// captions a person posts, and they want editing without touching code.
//
// THE FILE IS AN ARGUMENT. There are two sets now, and their keys overlap —
// both begin with "01-today" — so a hardcoded require does not fail loudly,
// it captions the explainer sheet's first post with the phone set's words and
// looks entirely finished doing it.
const CAPTIONS = require(path.resolve(process.argv[4]
  || path.join(__dirname, 'captions.json')));

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
      // 880 wide for a cell that displays around 440: 2×, so it stays crisp on
      // a retina screen. High-quality resampling has to be asked for — the
      // default is a fast box filter that eats small type, which is exactly
      // what a phone screenshot is made of.
      const w = 880, h = Math.round((im.naturalHeight / im.naturalWidth) * w);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(im, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.92);
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
  body{margin:0;padding:44px 32px 80px;background:var(--paper);color:var(--ink);
    font:15px/1.55 'Liberation Sans',Arial,Helvetica,sans-serif}
  .grid{max-width:1500px;margin:0 auto;display:grid;
    grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:44px 34px}
  figure{margin:0}
  figure img{width:100%;display:block;border:1px solid var(--line);border-radius:6px}
  figcaption{padding-top:12px}
  figcaption b{font-size:13px;letter-spacing:.4px;color:var(--gold)}
  .cap{margin:7px 0 0;white-space:normal}
  .tags{margin:7px 0 0;color:var(--muted);font-size:13px}
</style></head><body>
<div class="grid">${cards.join('\n')}</div>
</body></html>`);

  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`${cards.length} posts on the sheet · ${OUT} · ${kb}KB`);
})();
