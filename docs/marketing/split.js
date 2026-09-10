// One post, one folder's worth of files: the graphic, and the words that go
// beside it.
//
// The contact sheet is for deciding; this is for posting. The owner posts one
// a day, and on the day they want that day's image and that day's caption in
// front of them without a grid of thirteen others and without hunting through
// a JSON file for the right key.
//
// THE CAPTION IS NOT ON THE GRAPHIC, deliberately and on instruction. The
// design carries a kicker, a headline, one line and the screen; the paragraph
// goes in the post box where it can be edited, translated, or shortened for a
// platform without re-rendering an image.

const fs = require('fs');
const path = require('path');

const DAILY = path.resolve(process.argv[2] || path.join(__dirname, 'daily'));
const CAPTIONS = require('./captions.json');

const files = fs.readdirSync(DAILY).filter((f) => f.endsWith('.png')).sort();
if (!files.length) throw new Error(`no posts in ${DAILY} — run phones.js first`);

let missing = 0;
for (const f of files) {
  const key = f.replace(/\.png$/, '');
  const cap = CAPTIONS[key];
  // A caption file written from a missing key would be an empty file that
  // looks like a finished one — the same failure as an empty screenshot.
  if (!cap || !cap.caption) {
    console.log(`  ✗ ${key}: no caption in captions.json`);
    missing += 1;
    continue;
  }
  const body = `${cap.caption}\n\n${cap.tags || ''}\n`.replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(path.join(DAILY, `${key}.txt`), body);
  console.log(`  ✓ ${key}.png  +  ${key}.txt  (${cap.caption.length} chars)`);
}

// And one plain list, for reading the whole run in order without opening
// fourteen files.
const order = files.map((f, i) => {
  const key = f.replace(/\.png$/, '');
  const cap = CAPTIONS[key] || {};
  return `── Day ${i + 1} · ${f} ${'─'.repeat(Math.max(0, 46 - f.length))}\n\n`
    + `${cap.caption || '(no caption)'}\n\n${cap.tags || ''}\n`;
}).join('\n');
fs.writeFileSync(path.join(DAILY, 'ALL-CAPTIONS.txt'), order);

console.log(`\n${files.length - missing} posts split into image + caption in ${DAILY}`);
process.exit(missing ? 1 : 0);
