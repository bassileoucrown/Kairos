const { chromium } = require('/home/user/Kairos/node_modules/playwright-core');
const DIR = '/tmp/claude-0/-home-user-Kairos/7e78184d-9ae0-58d8-94a0-bd5eb2bf040e/scratchpad';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const jobs = process.argv.slice(2);
  for (const j of jobs) {
    const [file, w, h, out] = j.split(':');
    const p = await (await b.newContext({
      viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2,
    })).newPage();
    await p.goto(`file://${DIR}/${file}`);
    await p.waitForTimeout(400);
    // Overflow check: the canvas is fixed, so anything past it is cropped and
    // would be cropped silently.
    const over = await p.evaluate((hh) => ({
      docH: document.documentElement.scrollHeight,
      docW: document.documentElement.scrollWidth,
      limit: hh,
    }), Number(h));
    console.log(`${out}: content ${over.docW}x${over.docH} in ${w}x${h}` +
      (over.docH > over.limit ? `  ✗ OVERFLOWS BY ${over.docH - over.limit}px` : '  ok'));
    await p.screenshot({ path: `${DIR}/${out}`, clip: { x: 0, y: 0, width: Number(w), height: Number(h) } });
    await p.context().close();
  }
  await b.close();
})();
