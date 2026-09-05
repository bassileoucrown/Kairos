import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import AppShell from '../components/AppShell.jsx';
import QuickJot from '../components/QuickJot.jsx';
import { useAsk } from '../components/Ask.jsx';
import { EditItem } from './Itinerary.jsx';
import { dayLabelInZone, timeLabelInZone } from '../lib/timezones.js';

// One entry in the day, on its own page.
//
// WHY IT DID NOT HAVE ONE. An appointment somebody books has had its own page
// since the beginning; an entry the office makes itself — the car, the dinner,
// the school run — could only be changed from a small tool on the row that
// drew it. So changing a thing you made meant finding the day it was on
// first, which is backwards: what a person holds in their head is the dinner,
// not the date it sits under. And a schedule that can only be edited from one
// screen is one somebody eventually deletes and retypes, losing the notes and
// the series with the mistake.
//
// THE VERBS ARE THE SAME ONES THE ROW HAS, deliberately. Nothing new is
// possible here — it is the same PATCH, the same DELETE, the same publish and
// propose and decide. What is new is that they are reachable by clicking the
// thing itself, which is the only way anybody looks for them.

const KIND_LABEL = {
  meeting: 'Meeting', meal: 'Meal', travel: 'Travel', flight: 'Flight',
  drive: 'Car', personal: 'Personal', work: 'Work', other: 'Other',
};

const STATUS = {
  draft: { label: 'Draft', cls: ' is-off' },
  proposed: { label: 'Waiting on the principal', cls: ' is-warn' },
  confirmed: { label: 'On the day', cls: '' },
};

export default function ScheduleDetail() {
  const { ownerId, itemId } = useParams();
  const navigate = useNavigate();
  const [ask, askDialog] = useAsk();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const base = `/itinerary/${ownerId}/items/${itemId}`;

  function load() {
    return api.get(base).then(setData).catch((err) => setError(err.message));
  }
  useEffect(() => { setData(null); setError(''); load(); }, [ownerId, itemId]);

  const item = data?.item || null;
  const zone = data?.timezone || 'UTC';
  const viewerIsPrincipal = !!data?.viewerIsPrincipal;
  const past = item ? Date.parse(item.endAt || item.startAt) < Date.now() : false;

  async function act(path, body) {
    setBusy(true);
    setError('');
    try {
      await api.post(`${base}/${path}`, body);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  /**
   * Removing it, with the series question asked rather than assumed.
   *
   * A standing Tuesday meeting has three different cancellations and they are
   * not interchangeable — see the DELETE handler in routes/itinerary.js. The
   * row's own delete has always defaulted to "just this one"; a page with room
   * to ask should ask, because the wrong guess here takes out a year of
   * somebody's diary.
   */
  async function remove() {
    let scope = 'one';
    if (item.seriesId) {
      const answer = await ask({
        title: 'This repeats',
        label: 'How much of it should go?',
        hint: 'Type "one" for this one only, "following" for this and every one after, '
          + 'or "all" for the whole arrangement including what has already happened.',
        confirmLabel: 'Remove it',
      });
      if (!answer) return;
      scope = ['one', 'following', 'all'].includes(answer.trim().toLowerCase())
        ? answer.trim().toLowerCase() : null;
      if (!scope) { setError('Say one, following, or all.'); return; }
    } else if (!window.confirm(`Remove “${item.title}” from the day?`)) return;

    setBusy(true);
    try {
      await api.del(`${base}?scope=${scope}`);
      navigate('/itinerary');
    } catch (err) { setError(err.message); setBusy(false); }
  }

  const status = item ? (STATUS[item.status] || STATUS.confirmed) : null;

  return (
    <AppShell title="In the day" active="itinerary">
      {askDialog}
      {error && <div className="alert alert-error">{error}</div>}
      {data === null && !error && <p className="hint">Loading…</p>}

      {item && (
        <>
          <div className="card">
            <div className="booking-row">
              <div>
                <div className="when">
                  {status.label && (
                    <span className={`pill${status.cls}`} style={{ marginRight: 8 }}>
                      {status.label}
                    </span>
                  )}
                  {dayLabelInZone(item.startAt, zone)} · {timeLabelInZone(item.startAt, zone)}
                  {item.endAt && <> – {timeLabelInZone(item.endAt, zone)}</>}
                </div>
                <h2 style={{ margin: '6px 0 4px' }}>{item.title}</h2>
                <div className="meta">
                  {KIND_LABEL[item.kind] || item.kind}
                  {item.location && <> · {item.location}</>}
                  {item.destination && <> → {item.destination}</>}
                  {item.reference && <> · {item.reference}</>}
                </div>
                {item.recurrenceLabel && <div className="meta">{item.recurrenceLabel}</div>}
                {item.notes && <p className="sched-notes" style={{ marginTop: 8 }}>{item.notes}</p>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <Link className="btn btn-secondary btn-sm" to="/itinerary">Back to the day</Link>
              </div>
            </div>
          </div>

          {/* Said out loud rather than left to a card that quietly is not
              there. A past entry cannot be moved, and a screen that simply
              omits the button reads as a missing feature instead of a fact
              about the entry. */}
          {past && (
            <div className="card">
              <p className="hint" style={{ margin: 0 }}>
                This has already happened. It stays on the record as it was.
              </p>
            </div>
          )}

          {!past && (
            <div className="card">
              <h2 className="section-head" style={{ marginTop: 0 }}>Change it</h2>
              {!editing && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn-sm" type="button"
                    onClick={() => setEditing(true)}>
                    Edit the details
                  </button>
                  <button className="btn btn-danger btn-sm" type="button"
                    disabled={busy} onClick={remove}>
                    Remove it
                  </button>
                </div>
              )}
              {editing && (
                <div style={{ marginTop: 4 }}>
                  <EditItem
                    ownerId={ownerId}
                    item={item}
                    timezone={zone}
                    onSaved={() => { setEditing(false); load(); }}
                    onCancel={() => setEditing(false)}
                  />
                </div>
              )}
            </div>
          )}

          {/* The status verbs, exactly as the row offers them and to exactly
              the same people: an assistant publishes or asks; the principal
              approves or declines. */}
          {!past && !viewerIsPrincipal && item.status === 'draft' && (
            <div className="card">
              <h2 className="section-head" style={{ marginTop: 0 }}>It is still a draft</h2>
              <p className="hint">The principal cannot see it yet.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" type="button" disabled={busy}
                  onClick={() => act('publish')}>Publish it</button>
                <button className="btn btn-secondary btn-sm" type="button" disabled={busy}
                  onClick={async () => {
                    const note = await ask({
                      title: 'Send this for approval',
                      label: 'Anything they should know',
                      hint: 'Goes to them with the item. Leave it empty if it speaks for itself.',
                      multiline: true,
                      optional: true,
                      confirmLabel: 'Send it',
                    });
                    if (note === null) return;
                    act('propose', { note });
                  }}>Ask them</button>
              </div>
            </div>
          )}

          {!past && viewerIsPrincipal && item.status === 'proposed' && (
            <div className="card">
              <h2 className="section-head" style={{ marginTop: 0 }}>Waiting on you</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" type="button" disabled={busy}
                  onClick={() => act('decide', { approve: true })}>Approve</button>
                <button className="btn btn-secondary btn-sm" type="button" disabled={busy}
                  onClick={async () => {
                    const note = await ask({
                      title: 'Decline this',
                      label: 'Anything they should know',
                      hint: 'It goes back to their drafts rather than away, so a reason saves '
                        + 'a round trip.',
                      multiline: true,
                      optional: true,
                      confirmLabel: 'Decline',
                    });
                    if (note === null) return;
                    act('decide', { approve: false, note });
                  }}>Decline</button>
              </div>
            </div>
          )}

          <QuickJot ownerId={ownerId} about={{ kind: 'itinerary', id: item.id, title: item.title }} />
        </>
      )}
    </AppShell>
  );
}
