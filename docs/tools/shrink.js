// The step between capture.js and builddeck.js: make the pictures openable.
//
// WHY THIS EXISTS AS A FILE. It was done by hand the first time, which meant
// the course could not be rebuilt from a clone — capture.js writes shots/,
// builddeck.js reads small/, and nothing in the repository turned one into the
// other. That is the shape of a build that works once.
//
// WHAT IT IS FOR, and it is not disk. The first course was 7.8 MB and would
// not open; the version that finally did was not much smaller. The weight that
// mattered was DECODED BITMAP — a full-page screenshot of the Coming screen is
// 4832 pixels tall, which is 21 MB in memory the moment a browser paints it,
// and fifty of those is 225 MB of texture on a laptop that then stops
// responding. The file size on disk was never the problem.
//
// So two things happen here:
//
//   HEIGHT IS CAPPED at 1500 pixels. A full-page shot exists to show that a
//   screen continues, not to be read to the bottom; the top of it carries the
//   lesson. Anything cut is recorded in cropped.json so the course can say so
//   under the picture rather than pretending it is the whole screen.
//
//   WIDTH IS CAPPED at 1320, which is what the shots are taken at anyway. It
//   is here so a future viewport change does not silently double the bitmaps.
//
// Chromium does the encoding because there is no image library on this box —
// and it compresses better than anything that would have to be installed.
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const DECK = process.env.KAIROS_DECK_OUT || path.join(ROOT, 'docs', 'tools', 'build', 'deck');
const SHOTS = path.join(DECK, 'shots');
const SMALL = path.join(DECK, 'small');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const MAX_H = 1500;
const MAX_W = 1320;
const QUALITY = 0.62;

(async () => {
  if (!fs.existsSync(SHOTS)) {
    console.error(`No shots at ${SHOTS} — run capture.js first.`);
    process.exit(1);
  }
  fs.rmSync(SMALL, { recursive: true, force: true });
  fs.mkdirSync(SMALL, { recursive: true });

  const names = fs.readdirSync(SHOTS).filter((f) => f.endsWith('.jpg')).sort();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  });
  const page = await (await browser.newContext()).newPage();

  const cropped = [];
  let before = 0;
  let after = 0;

  for (const file of names) {
    const name = file.replace(/\.jpg$/, '');
    const raw = fs.readFileSync(path.join(SHOTS, file));
    before += raw.length;

    const out = await page.evaluate(async ({ dataUrl, maxW, maxH, quality }) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('could not decode'));
        image.src = dataUrl;
      });
      // Width scales the whole picture; height CUTS it. Scaling a 4832-pixel
      // page down to 1500 makes every word in it unreadable, which is worse
      // than showing the top of it and saying so.
      const scale = Math.min(1, maxW / image.width);
      const w = Math.round(image.width * scale);
      const fullH = Math.round(image.height * scale);
      const h = Math.min(fullH, maxH);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, image.width, Math.round(h / scale), 0, 0, w, h);
      return {
        data: canvas.toDataURL('image/jpeg', quality).split(',')[1],
        cut: fullH > maxH,
        w,
        h,
      };
    }, {
      dataUrl: `data:image/jpeg;base64,${raw.toString('base64')}`,
      maxW: MAX_W, maxH: MAX_H, quality: QUALITY,
    });

    const bytes = Buffer.from(out.data, 'base64');
    fs.writeFileSync(path.join(SMALL, file), bytes);
    after += bytes.length;
    if (out.cut) cropped.push(name);
    console.log(`  · ${name}  ${out.w}×${out.h}${out.cut ? ' (top only)' : ''}  `
      + `${Math.round(raw.length / 1024)}KB → ${Math.round(bytes.length / 1024)}KB`);
  }

  fs.writeFileSync(path.join(SMALL, 'cropped.json'), JSON.stringify(cropped, null, 1));
  await browser.close();

  console.log(`\n${names.length} pictures, ${cropped.length} cut to their top.`);
  console.log(`${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB on disk.`);
  // The number that actually decides whether the course opens.
  console.log(`At most ${Math.round(names.length * MAX_W * MAX_H * 4 / (1024 * 1024))}MB `
    + 'of bitmap if a browser painted every one at once — which is why the '
    + 'course paints only what is on screen.');
})();
