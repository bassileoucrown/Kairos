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

const app = express();
const PORT = process.env.PORT || 4000;

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
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

app.listen(PORT, () => {
  console.log(`Kairos API running at http://localhost:${PORT}`);
});
