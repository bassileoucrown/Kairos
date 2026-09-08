const { chromium } = require('/home/user/Kairos/node_modules/playwright-core');
const D = require('path').join(__dirname);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const [file, out] = process.argv.slice(2);
  const p = await (await b.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 })).newPage();
  await p.goto(`file://${D}/${file}`);
  await p.waitForTimeout(300);
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  console.log(`content ${h}px in 1123px` + (h > 1123 ? `  ✗ OVERFLOWS BY ${h - 1123}px` : '  ok — one page'));
  await p.screenshot({ path: `${D}/${out}.png`, clip: { x: 0, y: 0, width: 794, height: 1123 } });
  await p.pdf({ path: `${D}/${out}.pdf`, width: '794px', height: '1123px', printBackground: true });
  await b.close();
})();
