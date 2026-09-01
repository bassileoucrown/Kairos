const bookingNotes = require('../lib/bookingNotes');
const minutes = require('../lib/minutes');
const aiModel = require('../lib/aiModel');
const recordingLib = require('../lib/recording');

// Writing up a meeting — the handlers, once, for both doors.
//
// THERE ARE TWO WAYS INTO A BOOKING and they were always going to want the
// same endpoints: a principal minuting their own meeting (routes/bookings.js)
// and an assistant minuting it for them (routes/pa.js). Those two already keep
// parallel copies of the plain minute route, which was survivable for one
// four-line handler and is not for four handlers that call a model, hold a
// consent rule and touch a recording state machine.
//
// So each handler is written once here and mounted twice, and the ONLY thing
// that differs between the two mounts is who the owner is — supplied as a
// context function rather than sniffed from the request, so neither router can
// quietly grow a different idea of it.

/** A principal acting on their own booking. */
const own = (req) => ({ booking: req.booking, owner: req.user, author: req.user });
/** An assistant acting on the principal's booking. */
const forPrincipal = (req) => ({ booking: req.booking, owner: req.principal, author: req.user });

/** The one place that turns a model failure into words a screen can show. */
function modelError(res, err) {
  if (err instanceof aiModel.VaultRefusal || err.code === 'vault_off_limits') {
    return res.status(400).json({ error: aiModel.REFUSAL, code: 'vault_off_limits' });
  }
  if (err.code === 'model_not_configured') {
    return res.status(503).json({ error: aiModel.UNAVAILABLE, code: 'model_not_configured' });
  }
  // Anything else — the provider was down, the request timed out. Said as a
  // failure rather than dressed up: a screen that silently shows an empty box
  // teaches somebody the feature does not work and never says why.
  console.error(`Minute draft failed — ${err.message}`);
  return res.status(502).json({
    error: 'The draft could not be written just now. Nothing has been saved; try again, '
      + 'or write it yourself.',
    code: 'model_failed',
  });
}

/**
 * Draft a minute. WRITES NOTHING.
 *
 * The response is text on its way to a person's screen, where they will edit
 * it and press file — which is a second, separate request. That gap is the
 * whole design: there is no path from "the model produced words" to "the
 * office's record says so" that does not pass through somebody reading it.
 */
function draft(ctx) {
  return async (req, res) => {
    const { booking, author } = ctx(req);
    if (Date.parse(booking.start_at) > Date.now()) {
      return res.status(400).json({
        error: 'This meeting has not started yet. There is nothing to write up.',
      });
    }
    try {
      const { text, material } = await minutes.draftFrom(booking, author.id);
      return res.json({
        draft: text,
        // What it was written FROM, said out loud. A thin minute off two notes
        // is not the same as a thin minute off a bad model, and the person
        // about to put their name on it is entitled to know which.
        from: {
          notes: material.noteCount,
          dictation: material.hasDictation,
          truncated: material.truncated,
        },
      });
    } catch (err) {
      return modelError(res, err);
    }
  };
}

/**
 * What somebody said walking out of the room.
 *
 * Its own kind, not a note: it is raw and half-formed, and it is material for
 * a minute rather than a minute. See KINDS in lib/bookingNotes.js.
 */
function dictate(ctx) {
  return async (req, res) => {
    const { booking, owner, author } = ctx(req);
    const result = await bookingNotes.add({
      bookingId: booking.id,
      ownerId: owner.id,
      visibility: 'office',
      kind: 'dictation',
      authorUserId: author.id,
      body: req.body?.body,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json({ note: result.note });
  };
}

/** File the minute. The flag says a model drafted it; a person still filed it. */
function file(ctx) {
  return async (req, res) => {
    const { booking, owner, author } = ctx(req);
    const result = await bookingNotes.minute({
      booking,
      owner,
      author,
      body: req.body?.body,
      // A DISCLOSURE, NOT A CONTROL. It comes from the composer, which knows
      // whether the person pressed "draft this for me". Somebody could file a
      // hand-written minute claiming a model wrote it, which is a lie about
      // their own document and costs nobody anything. The reverse — a machine
      // marking its own work as human — is the one that would matter, and that
      // cannot happen because nothing but a person ever reaches this route.
      draftedByAi: !!req.body?.draftedByAi,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json({ note: result.note });
  };
}

/** Turn recording on or off. Never on by default, never on by itself. */
function recording(ctx) {
  return async (req, res) => {
    const { booking, author } = ctx(req);
    const result = await minutes.setRecording(booking, req.body?.state, author.id);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.json({
      state: result.state,
      // Returned with every change so the screen shows the same words the
      // starting notice used, rather than keeping its own copy.
      notice: minutes.CONSENT_NOTICE,
    });
  };
}

/**
 * The audio itself, after the fact.
 *
 * SEPARATE FROM TURNING IT ON, because they are separate acts with separate
 * failure modes — and because the state machine has to have been through `on`
 * before this will take a byte. lib/recording.js is where that is enforced;
 * this hands it the booking and gets back a sentence to show.
 */
function captureAudio(ctx) {
  return async (req, res) => {
    const { booking, author } = ctx(req);
    const result = await recordingLib.capture({
      booking,
      base64: req.body?.audio,
      mimeType: req.body?.mimeType,
      durationMs: req.body?.durationMs,
      userId: author.id,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, code: result.code });
    }
    return res.status(201).json({
      recording: { id: result.id, bytes: result.bytes, words: result.words },
      // Said on the way back, because the words are now office material a
      // minute can be drafted from and somebody should know that happened.
      material: 'The transcript is filed with the notes on this meeting.',
    });
  };
}

/** What was captured, never the audio. */
function recordings(ctx) {
  return async (req, res) => {
    const { booking } = ctx(req);
    res.json({
      recordings: await recordingLib.forBooking(booking.id),
      // So a screen can say which credential is missing rather than hiding the
      // control with no explanation.
      readiness: recordingLib.readiness(),
    });
  };
}

module.exports = {
  own, forPrincipal, draft, dictate, file, recording, captureAudio, recordings,
};
