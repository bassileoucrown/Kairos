const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'waitlist.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  }
}

function readAll() {
  ensureStore();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(entries) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

// Serializes writes within this process so concurrent requests
// can't interleave a read-modify-write and drop an entry.
let queue = Promise.resolve();
function withLock(fn) {
  const result = queue.then(fn);
  queue = result.then(() => {}, () => {});
  return result;
}

const ROLES = new Set([
  'individual_professional',
  'pa_ea_chief_of_staff',
  'organisation',
  'hni_family_office',
  'other',
]);

function normalizeRole(role) {
  return ROLES.has(role) ? role : 'other';
}

function addEntry({ email, name, role, source }) {
  return withLock(() => {
    const entries = readAll();
    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = entries.find((e) => e.email === normalizedEmail);
    if (existing) {
      return {
        created: false,
        position: entries.findIndex((e) => e.email === normalizedEmail) + 1,
        total: entries.length,
      };
    }

    const entry = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      email: normalizedEmail,
      name: name ? String(name).trim().slice(0, 200) : '',
      role: normalizeRole(role),
      source: source ? String(source).trim().slice(0, 200) : '',
      createdAt: new Date().toISOString(),
    };

    entries.push(entry);
    writeAll(entries);

    return {
      created: true,
      position: entries.length,
      total: entries.length,
    };
  });
}

function count() {
  return readAll().length;
}

module.exports = { addEntry, count, ROLES };
