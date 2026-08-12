const path = require('path');
const express = require('express');
const { attachUser } = require('./lib/auth');

const { router: authRouter } = require('./routes/auth');
const profileRouter = require('./routes/profile');
const availabilityRouter = require('./routes/availability');
const meetingTypesRouter = require('./routes/meetingTypes');
const bookingsRouter = require('./routes/bookings');
const publicBookingRouter = require('./routes/publicBooking');
const emailsRouter = require('./routes/emails');
const membersRouter = require('./routes/members');
const invitesRouter = require('./routes/invites');
const integrationsRouter = require('./routes/integrations');
const paRouter = require('./routes/pa');
const spacesRouter = require('./routes/spaces');
const threadsRouter = require('./routes/threads');
const projectsRouter = require('./routes/projects');
const tasksRouter = require('./routes/tasks');
const { router: itineraryRouter } = require('./routes/itinerary');
const todayRouter = require('./routes/today');
const workspaceRouter = require('./routes/workspace');
const db = require('./lib/db');
const { startReminderSweep } = require('./lib/reminders');

const app = express();
const PORT = process.env.PORT || 4000;

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Whether the database is usable yet. The server binds its port immediately
// and reports this, rather than refusing to start until the database answers.
//
// The old order made a database problem look like a deploy problem: nothing
// listened, so the platform showed a build that "succeeded" followed by a
// deploy spinning forever with no explanation, and the only way to learn
// anything was to read a log that stayed silent. Coming up and saying what is
// wrong is strictly more useful than dying quietly.
//
// It does NOT mean serving from a half-built database: every route below is
// held at 503 until the schema is ready. What changes is that the failure is
// now visible at a URL instead of invisible in a deploy queue.
const dbState = { ready: false, error: null };

app.get('/api/status', (req, res) => {
  res.json({
    storageDurable: db.dialect !== 'sqlite' || process.env.NODE_ENV !== 'production',
    emailDeliveryConfigured: !!process.env.RESEND_API_KEY,
    databaseReady: dbState.ready,
    databaseBackend: db.dialect,
    // Named so a human can compare it against their dashboard. Never the
    // password — this endpoint is public.
    databaseTarget: db.dialect === 'postgres' ? describeTarget() : 'local file',
    databaseError: dbState.error,
  });
});

// Only the API is held. The page itself must still load — a blank 503 tells a
// person nothing, whereas the app loading and reporting the error in its own
// words is something they can act on.
app.use('/api', (req, res, next) => {
  if (dbState.ready) return next();
  res.status(503).json({
    error: dbState.error
      ? `The database is not available: ${dbState.error}`
      : 'Starting up — the database is not ready yet. Try again in a moment.',
  });
});

app.use(attachUser);

app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/availability', availabilityRouter);
app.use('/api/meeting-types', meetingTypesRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/public', publicBookingRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/members', membersRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/pa', paRouter);
app.use('/api/spaces', spacesRouter);
app.use('/api/threads', threadsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/itinerary', itineraryRouter);
app.use('/api/today', todayRouter);
app.use('/api/workspace', workspaceRouter);

// In production, serve the built client and let it handle client-side routing.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

// Say what we are about to do before doing it. Connecting can take a moment,
// and a log that stays completely silent through it is indistinguishable from
// a process that has died — which is exactly how an unreachable database read
// on a deploy log until now.
console.log(`Kairos starting: ${db.dialect}${db.dialect === 'postgres' ? ` -> ${describeTarget()}` : ''}`);

// Listen first, so the deployment is always reachable and can account for
// itself even when the database cannot be reached.
app.listen(PORT, () => {
  console.log(`Kairos listening on ${PORT} — preparing the database…`);
});

db.ready()
  .then(() => {
    dbState.ready = true;
    startReminderSweep();
    console.log(`Kairos API running at http://localhost:${PORT} (${db.dialect})`);
  })
  .catch((err) => {
    dbState.error = err.message;
    // This is the last thing anyone sees when a deploy fails, so it has to be
    // enough to act on. Exiting rather than falling back to SQLite is
    // deliberate: DATABASE_URL being set means durable storage was asked for,
    // and quietly serving from a disk that gets wiped is how accounts went
    // missing in the first place. Better a failed deploy than a silent one.
    console.error(`\nCould not prepare the database: ${err.message}\n`);
    if (db.dialect === 'postgres') {
      console.error([
        'DATABASE_URL is set, so the server tried Postgres and could not use it.',
        '',
        `  code:  ${err.code || '(none)'}`,
        `  host:  ${describeTarget()}`,
        '',
        'Common causes, in the order worth checking:',
        '  - The URL points at a database that no longer exists (deleted, or expired',
        '    off the free plan). Confirm it in the dashboard, then re-copy the URL.',
        '  - The external URL was used where the internal one is needed, or vice',
        '    versa. On Render, a service in the same region wants the Internal URL.',
        '  - The password contains characters that must be percent-encoded in a URL',
        '    (@ : / ? # are the usual culprits). Re-copy rather than retype it.',
        '  - The database is still starting. The server already retried',
        `    ${process.env.DATABASE_CONNECT_ATTEMPTS || 6} times with backoff before giving up here.`,
        '',
        'Unset DATABASE_URL to start on local SQLite instead — the app runs, but',
        'stores accounts on disk that is wiped on restart.',
      ].join('\n'));
    } else {
      console.error('No DATABASE_URL is set, so the server tried a local SQLite file and could not open it.');
    }
    // Deliberately not exiting. The process stays up serving 503s and an
    // honest /api/status, which someone can read; exiting would put us back to
    // a deploy that fails with nothing to look at. It still never falls back
    // to ephemeral storage — a broken deployment that says so beats a working
    // one that quietly loses data.
    console.error('\nStaying up so /api/status can report this. No requests will be served until it is fixed.');
  });

// Enough of the connection target to identify it, never enough to leak the
// password — this goes to a deploy log that others may see.
function describeTarget() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    return `${u.hostname}:${u.port || 5432}${u.pathname} (user ${u.username || 'unset'})`;
  } catch {
    return 'unparseable DATABASE_URL — it must start with postgres:// or postgresql://';
  }
}
