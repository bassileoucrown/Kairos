const crypto = require('crypto');
const db = require('./db');
const objectStore = require('./objectStore');
const secretBox = require('./secretBox');

// What Kairos will take in as a file, and what it refuses.
//
// Until now the only bytes this product accepted were audio — a voice note and
// a meeting recording, each with its own short allow-list. A document is a
// different problem, because a document is a thing somebody hands to somebody
// else. It gets stored, it gets served back, and the two questions that decide
// whether that is safe are asked here, once:
//
//   IS IT THE KIND OF FILE WE SAID? Not "does its name end in .docx" and not
//   "did the browser call it a Word document" — both of those are typed by
//   whoever is uploading. The bytes are read. A file whose first bytes
//   disagree with its name is refused, because the only reason for that
//   disagreement is that somebody arranged it.
//
//   AND IS IT SENSITIVE? A document lands in the vault, so the answer is
//   almost always yes. The interesting case is the other one: a scan filed
//   under an ordinary field — an office address, a job title — that is
//   plainly a passport. See flagFor: sensitivity only ever ratchets up.
//
// WHAT IS DELIBERATELY NOT ACCEPTED, and why, because the list of refusals is
// the more load-bearing half:
//
//   .doc, .xls, .ppt      The pre-2007 Office formats are OLE compound files
//                         and can carry macros with no marker in the name. The
//                         modern equivalents cannot, which is why they are in.
//   .docm, .xlsm, .pptm   The same containers as .docx, with macros. Named
//                         separately by Microsoft precisely so they can be
//                         refused separately.
//   .svg, .html, .htm     Script-carrying documents that a browser will run.
//                         The one file type it is never worth serving back.
//   .zip, .rar, .7z       A container is a way to smuggle any of the above
//                         past a check that only looks at the outside.
//   Anything executable   Said out loud so nobody has to wonder.
//
// Everything served back goes out as an attachment with nosniff, so even a
// file that got past all of this is downloaded rather than rendered.

// 15 MB. A phone photograph of a passport page is 2-5 MB and a scanned
// contract is under 10; a board pack that will not fit was going to be sent
// some other way regardless. The cap exists so one upload cannot fill a
// bucket somebody else is paying for.
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * The formats, and how each one is recognised from its own bytes.
 *
 * `magic` is a list of signatures; any one matching is enough. A format with
 * no signature is one that genuinely has none — plain text is plain text —
 * and those are the two where the extension is all there is, which is why
 * they are also the two whose contents are read as text below.
 */
const FORMATS = [
  {
    id: 'pdf',
    label: 'PDF',
    ext: ['pdf'],
    mime: ['application/pdf'],
    magic: ['%PDF-'],
    what: 'A scan or an export. What most documents actually arrive as.',
  },
  {
    id: 'jpeg',
    label: 'JPEG image',
    ext: ['jpg', 'jpeg'],
    mime: ['image/jpeg'],
    magic: [Buffer.from([0xff, 0xd8, 0xff])],
    what: 'A photograph of a page, which is how a passport is usually captured.',
  },
  {
    id: 'png',
    label: 'PNG image',
    ext: ['png'],
    mime: ['image/png'],
    magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    what: 'A screenshot, or a scan an app produced.',
  },
  {
    // WITHOUT THIS, HALF THE PHOTOGRAPHS FAIL. An iPhone photographs in HEIC
    // by default, and a principal asked to convert a passport photo before
    // uploading it will instead email it to their PA — which is the exact
    // thing this feature exists to stop.
    id: 'heic',
    label: 'HEIC image',
    ext: ['heic', 'heif'],
    mime: ['image/heic', 'image/heif'],
    // The signature sits at offset 4: a box length, then 'ftyp', then a brand.
    magic: [{ at: 4, bytes: 'ftyp' }],
    what: 'What an iPhone takes photographs as, accepted so nobody has to convert one.',
    note: 'Held and handed back as it is; browsers will not preview it.',
  },
  {
    id: 'webp',
    label: 'WebP image',
    ext: ['webp'],
    mime: ['image/webp'],
    magic: [{ at: 0, bytes: 'RIFF' }],
    what: 'What some Android cameras and web downloads produce.',
  },
  {
    id: 'docx',
    label: 'Word document',
    ext: ['docx'],
    mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    magic: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ooxml: true,
    what: 'A letter, a contract, a brief — the format an office actually writes in.',
  },
  {
    id: 'xlsx',
    label: 'Excel workbook',
    ext: ['xlsx'],
    mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    magic: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ooxml: true,
    what: 'A schedule or a set of figures attached to the thing it is about.',
  },
  {
    id: 'pptx',
    label: 'PowerPoint deck',
    ext: ['pptx'],
    mime: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    magic: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
    ooxml: true,
    what: 'A board pack or a deck, kept with the meeting it belongs to.',
  },
  {
    id: 'txt',
    label: 'Plain text',
    ext: ['txt'],
    mime: ['text/plain'],
    magic: [],
    text: true,
    what: 'A note or an exported list.',
  },
  {
    id: 'csv',
    label: 'CSV',
    ext: ['csv'],
    mime: ['text/csv', 'application/csv', 'text/plain'],
    magic: [],
    text: true,
    what: 'A list of rows, from a bank or a booking system.',
  },
];

/**
 * Formats that are refused BY NAME, with the reason said out loud.
 *
 * A refusal that reads "that file type is not supported" teaches somebody to
 * rename the file and try again. These say what is actually wrong, which is
 * the difference between a rule and an obstacle.
 */
const REFUSED = [
  {
    ext: ['doc', 'xls', 'ppt'],
    why: 'The older Office formats can carry macros with nothing in the name to say so. '
      + 'Save it as .docx, .xlsx or .pptx and it will go straight in.',
  },
  {
    ext: ['docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm'],
    why: 'That is the macro-carrying version of an Office file. Save it without macros '
      + 'as .docx, .xlsx or .pptx.',
  },
  {
    ext: ['svg', 'html', 'htm', 'xhtml', 'mhtml'],
    why: 'A web document can run code in whoever opens it. Print it to PDF instead.',
  },
  {
    ext: ['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'dmg'],
    why: 'An archive hides what is inside it from every check this makes. Attach the '
      + 'documents themselves.',
  },
  {
    ext: ['exe', 'msi', 'bat', 'cmd', 'sh', 'app', 'apk', 'jar', 'scr', 'ps1', 'vbs', 'js'],
    why: 'That is a program, not a document.',
  },
];

const BY_ID = new Map(FORMATS.map((f) => [f.id, f]));

/** The extension, lower-cased, with no dot. '' when there is none. */
function extOf(filename) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(filename || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/** The declared type without the parameters browsers append. */
function baseMime(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

/** Whether these bytes start with one of a format's signatures. */
function matchesMagic(format, bytes) {
  if (!format.magic.length) return true;      // nothing to check against
  return format.magic.some((sig) => {
    if (typeof sig === 'string') return bytes.subarray(0, sig.length).toString('latin1') === sig;
    if (Buffer.isBuffer(sig)) return bytes.subarray(0, sig.length).equals(sig);
    const at = sig.at || 0;
    return bytes.subarray(at, at + sig.bytes.length).toString('latin1') === sig.bytes;
  });
}

/**
 * A macro project inside an Office file, found without unzipping it.
 *
 * .docx and .docm are the same container with the same first four bytes, so
 * the signature cannot separate them and a renamed .docm would otherwise walk
 * in as a Word document. A zip stores each entry's name in plain text in its
 * local header, so the name of the macro project is readable in the raw bytes
 * whether or not the entry itself is compressed.
 */
function carriesMacros(bytes) {
  return bytes.includes(Buffer.from('vbaProject.bin', 'latin1'))
    || bytes.includes(Buffer.from('vbaData.xml', 'latin1'));
}

/**
 * What this file is, or why it is not welcome.
 *
 * THE NAME AND THE DECLARED TYPE ARE BOTH TYPED BY THE UPLOADER, so neither
 * decides anything on its own. The extension picks a candidate; the bytes
 * confirm it. Disagreement is refused rather than resolved — a file that says
 * .pdf and starts with PK is not a PDF somebody mislabelled, it is a zip
 * somebody renamed, and guessing which was meant is how the check becomes
 * decorative.
 */
function identify({ filename, mimeType, bytes }) {
  const ext = extOf(filename);
  if (!ext) {
    return { ok: false, error: 'Give the file a name with its type on the end, like report.pdf.' };
  }

  const refused = REFUSED.find((r) => r.ext.includes(ext));
  if (refused) return { ok: false, error: refused.why };

  const format = FORMATS.find((f) => f.ext.includes(ext));
  if (!format) {
    return {
      ok: false,
      error: `Kairos does not take .${ext} files. It takes ${spokenList()}.`,
    };
  }

  if (!bytes || !bytes.length) return { ok: false, error: 'That file came through empty.' };
  if (bytes.length > MAX_BYTES) {
    return { ok: false, error: `A document can be at most ${MAX_BYTES / (1024 * 1024)} MB.` };
  }

  if (!matchesMagic(format, bytes)) {
    return {
      ok: false,
      error: `That file is named .${ext} but is not one. Check you attached the file you meant.`,
    };
  }
  if (format.ooxml && carriesMacros(bytes)) {
    return {
      ok: false,
      error: 'That document carries macros. Save it again without them and it will go in.',
    };
  }

  // The declared type is allowed to be missing or vague — some browsers send
  // nothing at all — but it is not allowed to CONTRADICT the bytes.
  const declared = baseMime(mimeType);
  if (declared && declared !== 'application/octet-stream' && !format.mime.includes(declared)) {
    const other = FORMATS.find((f) => f.mime.includes(declared));
    if (other) {
      return {
        ok: false,
        error: `That file is named .${ext} but was sent as ${other.label}. `
          + 'Check you attached the file you meant.',
      };
    }
  }

  return { ok: true, format };
}

/** "PDF, JPEG image, …" — the accepted list, for a refusal that has to name it. */
function spokenList() {
  const labels = FORMATS.map((f) => f.label);
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** What the screen offers, so the file picker and the server never disagree. */
function offered() {
  return FORMATS.map((f) => ({
    id: f.id,
    label: f.label,
    extensions: f.ext.map((e) => `.${e}`),
    accept: [...f.ext.map((e) => `.${e}`), ...f.mime].join(','),
    what: f.what,
    note: f.note || '',
  }));
}

/** Why each refused family is refused, for a screen that would rather say so first. */
function notOffered() {
  return REFUSED.map((r) => ({ extensions: r.ext.map((e) => `.${e}`), why: r.why }));
}

// ---- Flagging -----------------------------------------------------------
//
// WHAT MAKES A DOCUMENT SENSITIVE. Every document here is in the vault, so the
// field it hangs on has usually answered this already. The case worth catching
// is the other one: something filed under an ordinary field — an office
// address, a job title, a company boilerplate — that is plainly an identity
// document. A delegate engaged for scheduling can read ordinary fields, and a
// passport scan filed under one would walk straight past the gate.
//
// SO THE FLAG ONLY EVER GOES UP. Nothing here can make a document less
// protected than the field it was attached to; it can only decide that an
// ordinary field is holding something that is not ordinary. A ratchet is the
// only shape this can safely have — a rule that could downgrade would need to
// be right every time, and this one is a set of guesses about a filename.

const SENSITIVE_WORDS = [
  'passport', 'visa', 'national id', 'nin', 'bvn', 'birth certificate', 'certificate of birth',
  'driving licence', 'driving license', 'drivers licence', 'driver licence',
  'bank statement', 'account statement', 'statement of account', 'cheque', 'card',
  'voters card', 'voter card', 'pvc', 'residence permit', 'work permit',
  'medical', 'health', 'prescription', 'genotype', 'blood',
  'will', 'power of attorney', 'deed', 'title document', 'c of o',
  'tax clearance', 'payslip', 'salary',
];

// Shapes rather than words, for the text formats whose contents can be read
// without guessing. An 11-digit run is a BVN or a NIN; the other is the shape
// of a passport number.
const SENSITIVE_SHAPES = [
  /\b\d{11}\b/,
  /\b[A-Z]{1,2}\d{7,8}\b/,
];

/**
 * The sensitivity to store, given where it was filed and what it looks like.
 *
 * `text` is only ever passed for formats whose text can be read as bytes —
 * plain text and CSV. A PDF or a photograph is not read, and this is honest
 * about that rather than pretending: the field it is filed under is doing the
 * work there, and the vault's default is the strict one.
 */
function flagFor({ fieldSensitivity = 'sensitive', filename = '', label = '', text = '' } = {}) {
  if (fieldSensitivity === 'sensitive') return { sensitivity: 'sensitive', why: 'field' };

  const naming = `${filename} ${label}`.toLowerCase().replace(/[_-]+/g, ' ');
  const word = SENSITIVE_WORDS.find((w) => naming.includes(w));
  if (word) return { sensitivity: 'sensitive', why: 'name' };

  if (text && SENSITIVE_SHAPES.some((re) => re.test(text))) {
    return { sensitivity: 'sensitive', why: 'contents' };
  }
  return { sensitivity: fieldSensitivity, why: 'field' };
}

/** Said on the screen when the flag went up on its own, so nobody is surprised. */
const FLAG_NOTE = {
  name: 'Filed as sensitive because of what it appears to be. Only the account holder and '
    + 'a full-remit assistant can open it.',
  contents: 'Filed as sensitive because of what is written in it. Only the account holder '
    + 'and a full-remit assistant can open it.',
  field: '',
};

// ---- Holding one --------------------------------------------------------

function isAvailable() {
  return objectStore.isConfigured() && secretBox.isConfigured();
}

const UNAVAILABLE = 'Documents need object storage and an encryption key set on the server, '
  + 'so they cannot be attached yet. A scanned passport should not be held without both.';

function keyFor(ownerId, id) {
  return `documents/${ownerId}/${id}`;
}

/**
 * Take a document in.
 *
 * ENCRYPTED BEFORE IT LEAVES THIS PROCESS, exactly as a recording is, so the
 * bytes crossing the wire to the bucket are already unreadable and the store
 * operator is not a party to the vault. The row records what it is; the bucket
 * holds what it says.
 */
async function attach({
  ownerId, essentialId, uploadedBy, filename, mimeType, bytes,
  fieldSensitivity = 'sensitive', label = '',
}) {
  if (!isAvailable()) {
    return { ok: false, status: 503, code: 'not_configured', error: UNAVAILABLE };
  }
  const seen = identify({ filename, mimeType, bytes });
  if (!seen.ok) return { ok: false, status: 400, code: 'bad_document', error: seen.error };

  const flag = flagFor({
    fieldSensitivity,
    filename,
    label,
    text: seen.format.text ? bytes.toString('utf8').slice(0, 20000) : '',
  });

  const id = crypto.randomUUID();
  const objectKey = keyFor(ownerId, id);
  const sealed = Buffer.from(secretBox.encrypt(bytes.toString('base64')), 'utf8');
  await objectStore.put(objectKey, sealed, 'application/octet-stream');

  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO documents
      (id, owner_id, essential_id, object_key, format, mime_type, filename, bytes,
       sensitivity, flagged_by, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ownerId, essentialId, objectKey, seen.format.id, seen.format.mime[0],
    String(filename).trim().slice(0, 200), bytes.length,
    flag.sensitivity, flag.why, uploadedBy, now);

  const row = await db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  return { ok: true, document: serialize(row) };
}

/** What a document is, without being the document. Never carries the bytes. */
function serialize(row) {
  return {
    id: row.id,
    essentialId: row.essential_id,
    filename: row.filename,
    format: row.format,
    formatLabel: BY_ID.get(row.format)?.label || row.format,
    mimeType: row.mime_type,
    bytes: row.bytes,
    sensitivity: row.sensitivity,
    // Why it is filed the way it is, said only when it was not the field's
    // own doing — a screen that explains every filing explains nothing.
    flagNote: FLAG_NOTE[row.flagged_by] || '',
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    gone: !row.object_key,
  };
}

/** The documents on one essential entry. */
async function forEssential(essentialId) {
  const rows = await db.prepare(
    'SELECT * FROM documents WHERE essential_id = ? ORDER BY created_at',
  ).all(essentialId);
  return rows.map(serialize);
}

/**
 * The bytes themselves, decrypted.
 *
 * The caller decides who is entitled to them — this is the vault's shape, not
 * its gate, the same division recording.js draws.
 */
async function open(documentId) {
  const row = await db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
  if (!row || !row.object_key) return null;
  const sealed = await objectStore.get(row.object_key);
  if (!sealed) return null;
  const plain = secretBox.decrypt(sealed.toString('utf8'));
  if (plain === null) return null;
  return { row, bytes: Buffer.from(plain, 'base64'), mimeType: row.mime_type, filename: row.filename };
}

/**
 * Throw one away.
 *
 * THE ROW GOES TOO, unlike a recording's. A recording's row survives because
 * "was this meeting taped" is a question the record has to answer forever. A
 * document is the opposite: a principal who removes a passport scan is asking
 * for it to be gone, and the access log already holds the history of who
 * opened it while it existed.
 */
async function remove(documentId) {
  const row = await db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
  if (!row) return false;
  if (row.object_key) await objectStore.del(row.object_key).catch(() => {});
  await db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
  return true;
}

module.exports = {
  MAX_BYTES, FORMATS, REFUSED,
  extOf, baseMime, identify, offered, notOffered, spokenList, carriesMacros,
  flagFor, FLAG_NOTE,
  isAvailable, UNAVAILABLE, attach, forEssential, open, remove, serialize,
};
