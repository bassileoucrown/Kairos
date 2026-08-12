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
const db = require('./lib/db');
const { startReminderSweep } = require('./lib/reminders');

const app = express();
const PORT = process.env.PORT || 4000;

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(attachUser);

// Unauthenticated, and deliberately so: it reports properties of the
// deployment, never of any account. A production server running on SQLite has
// an ephemeral disk, so every account it holds disappears on the next restart
// or deploy — which arrives at the login screen disguised as "incorrect email
// or password". The login page reads this to say what actually happened.
app.get('/api/status', (req, res) => {
  res.json({
    storageDurable: db.dialect !== 'sqlite' || process.env.NODE_ENV !== 'production',
    emailDeliveryConfigured: !!process.env.RESEND_API_KEY,
  });
});

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

// The schema has to exist before the first request touches it, and creating
// it is now asynchronous, so listen only once it's ready.
db.ready()
  .then(() => {
    startReminderSweep();
    app.listen(PORT, () => {
      console.log(`Kairos API running at http://localhost:${PORT} (${db.dialect})`);
    });
  })
  .catch((err) => {
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
    process.exit(1);
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
