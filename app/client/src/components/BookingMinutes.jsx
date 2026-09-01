import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import AssistButton from './AssistButton.jsx';
import MeetingRecorder from './MeetingRecorder.jsx';
import { dayLabelInZone, timeLabelInZone } from '../lib/timezones.js';

/**
 * The account of what happened, for a principal who was not in the room.
 *
 * WHY IT IS NOT A NOTE. A note is preparation — which car, what he likes, what
 * was agreed internally beforehand. Minutes are the record afterwards, and they
 * are the single most valuable thing an assistant produces: "he agreed to fund
 * the second tranche, subject to the audit" is the sentence a principal will
 * still be relying on in six months. Filed among the notes it would sit under
 * "he prefers the corner table", and be read with the same weight.
 *
 * NEVER REACHES THE PERSON MINUTED. Minutes are office-only by construction —
 * the server forces it rather than offering it, so there is no dropdown here to
 * get wrong. That matters because minutes are candid by nature, and the booker
 * holds a link they can forward to anybody.
 *
 * THE PRINCIPAL IS TOLD. Filing minutes knocks — an alert and an email — since
 * a record on a page nobody has cause to open has informed nobody. That is the
 * whole of "for the principal's information".
 */
export default function BookingMinutes({ ownerId, bookingId, startAt, timezone, onChanged }) {
  const [minutes, setMinutes] = useState(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  // Tracks that THIS text came from a draft, so the filed minute can say so.
  // Cleared the moment the box is emptied, because a minute typed from scratch
  // after discarding a draft was not drafted by anything.
  const [fromDraft, setFromDraft] = useState(false);
  const [draftedFrom, setDraftedFrom] = useState(null);
  const [dictating, setDictating] = useState(false);
  const [dictation, setDictation] = useState('');
  // Whatever an ask came back with, shown beside the composer rather than in it.
  const [aside, setAside] = useState(null);

  const base = `/pa/${ownerId}/bookings/${bookingId}`;

  function load() {
    api.get(`${base}/notes`)
      .then((d) => setMinutes((d.notes || []).filter((n) => n.kind === 'minute')))
      .catch((err) => setError(err.message));
  }
  useEffect(load, [ownerId, bookingId]);

  // Asks for a draft. Writes nothing on the server — what comes back lands in
  // the box below for a person to edit, and filing it is a separate act.
  async function askForDraft() {
    setError('');
    setDrafting(true);
    try {
      const d = await api.post(`${base}/minutes/draft`);
      setBody(d.draft);
      setFromDraft(true);
      setDraftedFrom(d.from);
    } catch (err) {
      // The server distinguishes "no model here" from "the model failed" from
      // "you asked for something out of the vault", and each wants different
      // words. Passing err.message through keeps all three.
      setError(err.message);
    } finally { setDrafting(false); }
  }

  async function saveDictation(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post(`${base}/dictation`, { body: dictation });
      setDictation('');
      setDictating(false);
      load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function file(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post(`${base}/minutes`, { body, draftedByAi: fromDraft });
      setBody('');
      setFromDraft(false);
      setDraftedFrom(null);
      load();
      onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  // Before it starts there is nothing to minute. Said rather than disabled: a
  // greyed box with no reason beside it is a thing people click twice and then
  // give up on.
  const started = !startAt || Date.parse(startAt) <= Date.now();

  return (
    <div className="booking-minutes">
      {error && <div className="alert alert-error">{error}</div>}
      {minutes === null && <p className="hint">Loading…</p>}

      {minutes?.length === 0 && started && (
        <p className="hint">
          Nothing minuted yet. What was agreed, what was asked for, what happens next.
        </p>
      )}

      {minutes?.map((m) => (
        <div className="minute-line" key={m.id}>
          <div className="minute-who">
            {m.authorName || 'The office'}
            {' · '}
            <span className="minute-when">
              {dayLabelInZone(m.createdAt, timezone || 'UTC')}
              {' · '}{timeLabelInZone(m.createdAt, timezone || 'UTC')}
            </span>
          </div>
          {/* Said on the document itself, permanently. Whether a machine
              wrote the first version of a minute somebody is relying on six
              months later is a fact about that minute, not a detail of how it
              was composed. */}
          {m.draftedByAi && (
            <span className="pill is-warn" title="Drafted by Kairos, edited and filed by a person">
              AI-drafted
            </span>
          )}
          <div className="minute-body">{m.body}</div>
        </div>
      ))}

      {/* Recording belongs to the meeting itself rather than to the write-up,
          so it sits above both halves. See components/MeetingRecorder.jsx —
          nothing starts without somebody reading the notice and pressing
          again, and the deployment says which credential it is waiting on
          rather than hiding the control. */}
      <MeetingRecorder ownerId={ownerId} bookingId={bookingId} onChanged={load} />

      {/* OUTSIDE the started/not-started split, deliberately. Everything below
          is the record AFTERWARDS and correctly waits for the meeting to
          begin. A briefing note is the opposite: it is what you read in the
          car on the way there, and a control that only appears once the
          meeting has started is a control that appears too late to be the
          thing it is for. */}
      <div className="minute-tools">
        <AssistButton
          feature="ai_meeting_brief"
          path={`/assist/${ownerId}/meetings/${bookingId}/brief`}
          label="Brief me"
          onResult={(d) => setAside({ head: 'Before you go in', text: d.text })}
        />
      </div>

      {/* Both asks land here. Proposals, never tasks — creating them is a
          separate act somebody takes on the task screen. See lib/assist.js. */}
      {aside && (
        <div className="assist-out">
          <div className="assist-out-head">{aside.head}</div>
          {aside.text}
        </div>
      )}

      {started ? (
        <>
        {/* THE ORDER MATTERS. Dictating comes first because it is what somebody
            actually does — thirty seconds in the car, before any of it is
            gone — and asking them to write the formal minute at that moment is
            how meetings go unrecorded. */}
        <div className="minute-tools">
          {dictating ? (
            <form className="minute-dictate" onSubmit={saveDictation}>
              <textarea
                aria-label="What happened, in your own words"
                rows={3}
                value={dictation}
                onChange={(e) => setDictation(e.target.value)}
                placeholder="He'll come back on the second tranche. Wants the audit first…"
              />
              <p className="hint">
                Raw and unedited — material for the minutes, not the minutes themselves.
              </p>
              <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !dictation.trim()}>
                Save it
              </button>
              <button className="btn btn-sm" type="button" onClick={() => setDictating(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button className="btn btn-sm" type="button" onClick={() => setDictating(true)}>
              Say what happened
            </button>
          )}
          <button className="btn btn-sm" type="button" onClick={askForDraft} disabled={drafting}>
            {drafting ? 'Writing…' : 'Draft the minutes for me'}
          </button>
          {/* The actions AFTER. The briefing note is the other half and sits
              above, outside this block — see there for why. */}
          <AssistButton
            feature="ai_minute_tasks"
            path={`/assist/${ownerId}/meetings/${bookingId}/minute-tasks`}
            label="Find the actions"
            onResult={(d) => setAside({
              head: 'Agreed in the minutes — make these tasks?',
              text: (d.tasks || []).length
                ? d.tasks.map((t) => `• ${t.title}`
                  + (t.owner ? ` — ${t.owner}` : '')
                  + (t.dueOn ? ` (by ${t.dueOn})` : '')).join('\n')
                : 'The minutes do not record anybody agreeing to do anything.',
            })}
          />
        </div>

        <form onSubmit={file}>
          {/* What it was written FROM. A thin minute off two notes is not the
              same as a thin minute off a bad model, and the person about to put
              their name to it is entitled to know which. */}
          {fromDraft && (
            <p className="hint minute-drafted">
              Drafted from {draftedFrom?.notes || 0} note{draftedFrom?.notes === 1 ? '' : 's'}
              {draftedFrom?.dictation ? ' and what you said afterwards' : ''}.
              {' '}Read it before you file it — it will be filed as yours, marked as AI-drafted.
            </p>
          )}
          <textarea
            aria-label="Minutes of this meeting"
            rows={fromDraft ? 12 : 4}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              if (!e.target.value.trim()) setFromDraft(false);
            }}
            placeholder="What was agreed, what was asked for, what happens next…"
          />
          <p className="hint">
            Office only — the person you met never sees this. Filing it tells the principal.
          </p>
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !body.trim()}>
            {busy ? 'Filing…' : 'File the minutes'}
          </button>
        </form>
        </>
      ) : (
        <p className="hint">
          Minutes can be written once the meeting has started. Until then, an office
          note is the right place for anything to prepare.
        </p>
      )}
    </div>
  );
}
