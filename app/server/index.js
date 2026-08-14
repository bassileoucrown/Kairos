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
const securityRouter = require('./routes/security');
const { router: essentialsRouter } = require('./routes/essentials');
const connectionsRouter = require('./routes/connections');
const householdRouter = require('./routes/household');
const announcementsRouter = require('./routes/announcements');
const accessCodesRouter = require('./routes/accessCodes');
const tripsRouter = require('./routes/trips');
const db = require('./lib/db');
const { startReminderSweep } = require('./lib/reminders');
const { startVoiceExpiry } = require('./lib/voiceNotes');
const { isConfigured: emailConfigured } = require('./lib/emailProviders');

const app = express();
const PORT = process.env.PORT || 4000;

app.disable('x-powered-by');

// 100 KB everywhere, and one exception that has to be carved out here rather
// than at the route.
//
// A voice note is a recording inside a JSON body, and no recording fits in
// 100 KB. A parser mounted on the route cannot help: this one runs first,
// rejects the body, and the route's own limit never sees it — which showed up
// as a 500 on any note longer than a few seconds. So the voice paths skip the
// global parser and declare their own ceiling, and every other endpoint keeps
// the tight limit that stops an ordinary JSON route being handed megabytes.
const standardJson = express.json({ limit: '100kb' });
app.use((req, res, next) => {
  if (req.method === 'POST' && /^\/api\/threads\/[^/]+\/voice$/.test(req.path)) return next();
  return standardJson(req, res, next);
});

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
    emailDeliveryConfigured: emailConfigured(),
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
app.use('/api/security', securityRouter);
app.use('/api/essentials', essentialsRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/household', householdRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/access-codes', accessCodesRouter);
app.use('/api/trips', tripsRouter);

// An unmatched API path is a mistake, and it should say so.
//
// Without this it fell through to the SPA catch-all below and answered 200
// with a page of HTML, which the client then failed to parse — and, worse,
// made a security test that asked "can this person reach that endpoint" read
// as a pass. An API that answers 200 to a route it does not have cannot be
// checked by anything.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'No such endpoint.' });
});

// In production, serve the built client and let it handle client-side routing.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  // An oversized body is the caller's problem and they can act on it. Reported
  // as "something went wrong" it looks like a fault in the app, and the person
  // holding a recording that will not send has no idea it was simply too big.
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That is too large to send.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

// Say what we are about to do before doing it. Connecting can take a moment,
// and a log that stays completely silent through it is indistinguishable from
// a process that has died — which is exactly how an unreachable database read
// on a deploy log until now.
console.log(`Kairos starting: ${db.dialect}${db.dialect === 'postgres' ? ` -> ${describeTarget()}` : ''}`);

// A crash after the port is bound reads to the outside world as "502 Bad
// Gateway" with no further explanation, which is the same diagnostic dead end
// as a silent deploy. Log it properly and keep serving: a background failure
// should not take the whole site down, and whatever is still working should
// stay working.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (staying up):', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (staying up):', err.stack || err);
});

// Listen first, so the deployment is always reachable and can account for
// itself even when the database cannot be reached.
//
// 0.0.0.0 explicitly: a container's proxy reaches the process over the
// container network, and a server bound only to loopback answers nothing from
// outside — which surfaces as a gateway error rather than as a bind failure.
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kairos listening on 0.0.0.0:${PORT} — preparing the database…`);
});
server.on('error', (err) => {
  console.error(`Could not listen on port ${PORT}: ${err.message}`);
  process.exit(1);
});

// Keep trying, quietly, for as long as it takes.
//
// A database being provisioned can take several minutes — longer than any
// startup ladder should wait — and giving up permanently would leave the app
// broken until somebody redeployed it by hand, for a problem that fixed
// itself. So a failed attempt schedules another. The app repairs itself the
// moment the database appears.
const RECHECK_MS = Number(process.env.DATABASE_RECHECK_MS || 30000);

function attemptReady() {
  db.ready()
    .then(() => {
      dbState.ready = true;
      dbState.error = null;
      startReminderSweep();
      // Recordings past their retention date are dropped on a timer, so the
      // deadline holds without anybody remembering to enforce it.
      startVoiceExpiry();
      console.log(`Kairos API running at http://localhost:${PORT} (${db.dialect})`);
    })
    .catch((err) => {
      reportFailure(err);
      db.resetIfFailed();
      console.error(`Rechecking in ${RECHECK_MS / 1000}s — no redeploy needed if the database simply isn't up yet.`);
      setTimeout(attemptReady, RECHECK_MS).unref?.();
    });
}

attemptReady();

function reportFailure(err) {
  dbState.error = err.message;
  // Has to be enough to act on: it is what someone reads when the site is
  // up but refusing to serve.
  console.error(`\nCould not prepare the database: ${err.message}\n`);
  // When the value itself is malformed we already know exactly what is wrong,
  // and a list of other things it might have been only buries the answer.
  // Advice worth reading is advice about the host you actually have. The
  // generic list used to tell a Supabase user about Render's internal URLs,
  // which is worse than saying nothing — it sends someone hunting for a
  // setting their provider does not have.
  function hostSpecificAdvice() {
    let host = '';
    try { host = new URL(process.env.DATABASE_URL || '').hostname; } catch { /* unparseable */ }

    if (/supabase/.test(host)) {
      return [
        '  - On Supabase, the "Direct connection" host (db.<ref>.supabase.co) is',
        '    IPv6-only and most platforms cannot reach it. Use the Session pooler',
        '    string instead: username postgres.<ref>, host ...pooler.supabase.com,',
        '    port 5432.',
      ];
    }
    if (/render\.com/.test(host)) {
      return [
        '  - On Render, a service in the same region wants the Internal Database',
        '    URL. The External one is for connecting from outside Render.',
      ];
    }
    return [];
  }

  if (/not a Postgres connection string/.test(err.message)) {
    console.error('Fix DATABASE_URL on this service and it will connect on the next check.');
    return;
  }
  if (db.dialect === 'postgres') {
    console.error([
      'DATABASE_URL is set, so the server tried Postgres and could not use it.',
      '',
      `  code:  ${err.code || '(none)'}`,
      `  host:  ${describeTarget()}`,
      '',
      'Common causes, in the order worth checking:',
      '  - The password contains a character that breaks a URL. An @ is the worst',
      '    one: everything after it is read as the hostname, so the connection goes',
      '    looking for a server that does not exist and times out exactly like this.',
      '    : / ? # % & also need percent-encoding. The quickest fix is to reset the',
      '    password to letters and digits only and make it longer instead.',
      ...hostSpecificAdvice(),
      '  - The database no longer exists — deleted, or expired off a free plan.',
      '    Confirm it is listed and healthy in the dashboard, then re-copy the URL.',
      '  - The database is still starting. The server already retried',
      `    ${process.env.DATABASE_CONNECT_ATTEMPTS || 5} times with backoff before giving up here.`,
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
}

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
