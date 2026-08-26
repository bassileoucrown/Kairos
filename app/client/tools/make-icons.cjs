// The app's icons, generated rather than dropped in.
//
// A binary nobody can regenerate is a binary nobody dares change. This renders
// them from one SVG with the Chromium already on the box, so the mark can be
// edited here and rebuilt, and so anybody reading the repo can see exactly what
// the icon is made of.
//
//   node tools/make-icons.cjs
//
// MASKABLE IS NOT THE SAME PICTURE. Android crops an icon to whatever shape the
// launcher uses — circle, squircle, teardrop — and guarantees only the middle
// 80% survives. So the maskable version paints the background edge to edge and
// keeps the glyph well inside that circle; the ordinary one can use the full
// square because nothing is cut off it.
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..', '..');
const { chromium } = require(`${ROOT}/node_modules/playwright-core`);

const ACCENT = '#3E6357';
const CREAM = '#FAF9F6';
const OUT = path.join(__dirname, '..', 'public', 'icons');

/**
 * The mark: a K cut from a field of the brand green.
 *
 * `inset` is how much of the canvas the artwork keeps clear of the edge — zero
 * for the plain icon, a fifth for the maskable one, where the corners are the
 * launcher's to remove.
 */
function svg({ size, radius, inset, bleed }) {
  const pad = size * inset;
  const inner = size - pad * 2;
  // The glyph, drawn in a 100x100 box and scaled, so the proportions hold at
  // every size instead of being retuned three times.
  const scale = inner / 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${bleed ? 0 : size * 0.02}" y="${bleed ? 0 : size * 0.02}"
        width="${bleed ? size : size * 0.96}" height="${bleed ? size : size * 0.96}"
        rx="${radius}" fill="${ACCENT}"/>
  <g transform="translate(${pad} ${pad}) scale(${scale})">
    <path d="M28 18 L28 82" stroke="${CREAM}" stroke-width="11" stroke-linecap="round"/>
    <path d="M72 18 L34 48 L74 82" stroke="${CREAM}" stroke-width="11"
          stroke-linejoin="round" stroke-linecap="round" fill="none"/>
  </g>
</svg>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  });
  const page = await browser.newPage();

  const jobs = [
    { file: 'icon-192.png', size: 192, radius: 40, inset: 0.22, bleed: false },
    { file: 'icon-512.png', size: 512, radius: 108, inset: 0.22, bleed: false },
    // Edge to edge, glyph tucked inside the safe circle.
    { file: 'icon-maskable-512.png', size: 512, radius: 0, inset: 0.28, bleed: true },
    // iOS applies its own rounding and does not like transparency, so this is
    // a full square of colour with no corner radius of its own.
    { file: 'apple-touch-icon.png', size: 180, radius: 0, inset: 0.24, bleed: true },
    // The browser tab.
    { file: 'favicon-32.png', size: 32, radius: 6, inset: 0.18, bleed: false },
  ];

  for (const job of jobs) {
    const markup = svg(job);
    await page.setViewportSize({ width: job.size, height: job.size });
    await page.setContent(
      `<body style="margin:0">${markup}</body>`,
      { waitUntil: 'load' },
    );
    await page.screenshot({
      path: path.join(OUT, job.file),
      omitBackground: true,
      clip: { x: 0, y: 0, width: job.size, height: job.size },
    });
    console.log(`  ${job.file}  ${job.size}x${job.size}`);
  }

  await browser.close();
  console.log('Icons written to public/icons.');
})().catch((e) => { console.error(e); process.exit(1); });
