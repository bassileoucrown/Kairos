import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import AssistButton from '../components/AssistButton.jsx';
import { useAuth } from '../lib/AuthContext.jsx';

// The six kinds of record, said the way a person would read them back rather
// than as the value stored. sign_off is the one that would otherwise render
// with an underscore in the middle of a sentence.
const RECORD_LABEL = {
  decision: 'Decision',
  approval: 'Approval',
  request: 'Request',
  update: 'Update',
  sign_off: 'Sign-off',
  blocker: 'Blocker',
};

// What the office did last week.
//
// DELIBERATELY NOT A LEADERBOARD. The numbers are grouped by person because
// that is the only way to read them, but there is no total across people, no
// ordering by output and no score — an assistant whose week went into one
// difficult negotiation would come bottom of any such table, and a screen that
// invites a principal to read it that way makes offices worse rather than
// better. Each person's card stands alone.

const GROUPS = [
  {
    heading: 'The diary',
    rows: [
      ['approved', 'requests approved'],
      ['declined', 'requests declined'],
      ['moved', 'meetings moved'],
      ['calledOff', 'meetings called off'],
      ['putIn', 'put in the diary'],
    ],
  },
  {
    heading: 'Work',
    rows: [
      ['tasksDone', 'tasks finished'],
      ['tasksSet', 'tasks handed out'],
      ['records', 'records filed'],
      ['messages', 'messages written'],
    ],
  },
  {
    heading: 'Papers',
    rows: [
      ['documentsConfirmed', 'documents confirmed'],
      ['documentsAdded', 'documents added'],
      ['documentsRevealed', 'documents looked at'],
      ['keptToArchive', 'things kept to the archive'],
      ['houseInstructions', 'instructions to the house'],
    ],
  },
];

function PersonCard({ person }) {
  if (person.quiet) {
    return (
      <div className="card report-person">
        <div className="report-who">
          {person.name} <span className="pill is-off">{person.roleLabel}</span>
        </div>
        <p className="hint">Nothing recorded this week.</p>
      </div>
    );
  }
  return (
    <div className="card report-person">
      <div className="report-who">
        {person.name} <span className="pill">{person.roleLabel}</span>
      </div>
      <div className="report-groups">
        {GROUPS.map((g) => {
          const rows = g.rows.filter(([key]) => person.counts[key] > 0);
          if (!rows.length) return null;
          return (
            <div className="report-group" key={g.heading}>
              <h4>{g.heading}</h4>
              {/* Only what happened. A column of zeroes reads as an accusation
                  and buries the two numbers that are actually there. */}
              {rows.map(([key, label]) => (
                <div className="report-line" key={key}>
                  <span className="report-n">{person.counts[key]}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// What the reader is actually deciding about on a Monday morning: not what
// happened, but what is coming and what has been sitting untouched. The
// backward half of this screen is a record; this half is the reason to read it.
const NEGLECT_LABEL = {
  task: 'Task', stage: 'Stage', record: 'Record', proposal: 'Waiting on you',
};

// TWO PARTS SHARE ONE COMPONENT, so each has to carry its own heading.
//
// They are drawn together because they are computed together — one fetch of
// the week ahead produces both the counts and the neglected list. But the
// reader can ask for either alone, and a heading that outlives the section
// under it is the exact failure this whole feature exists to prevent: "The
// week ahead" over nothing reads as a week with nothing in it, not as a
// section that was not asked for. The same goes in the other direction —
// "Nothing is sitting untouched" is a verdict, and a document that was never
// asked to look must not deliver one.
function WeekAhead({ ahead, ownerId, showAhead = true, showAttention = true }) {
  const [read, setRead] = useState('');
  const due = ahead.tasksDue.length + ahead.moreTasksDue;
  const stages = ahead.stagesDue.length + ahead.moreStagesDue;
  return (
    <div className="report-ahead">
      {showAhead && (
        <h3>
          The week ahead
          <span className="hint"> · {ahead.window.startDate} to {ahead.window.endDate}</span>
        </h3>
      )}

      {/* The counts are below. This is the observation on top of them — where
          the week is tight, and what would have to move if something slipped.
          It reads the week, so it belongs to the week's part. */}
      {showAhead && (
      <div className="assist-control" style={{ margin: '0 0 10px' }}>
        <AssistButton
          feature="ai_week_ahead"
          path={`/assist/${ownerId}/week-ahead`}
          label="Read the week"
          onResult={(d) => setRead(d.empty ? 'There is nothing in the week ahead yet.' : d.text)}
        />
      </div>
      )}
      {showAhead && read && <div className="assist-out">{read}</div>}

      {showAhead && (
      <div className="report-tiles">
        <div><strong>{ahead.appointments}</strong><span>appointment{ahead.appointments === 1 ? '' : 's'}</span></div>
        <div><strong>{due}</strong><span>task{due === 1 ? '' : 's'} fall due</span></div>
        <div><strong>{stages}</strong><span>stage{stages === 1 ? '' : 's'} fall due</span></div>
      </div>
      )}

      {showAhead && ahead.trips.length > 0 && (
        <p className="hint">
          Away: {ahead.trips.map((t) => `${t.name} (${t.startsOn}–${t.endsOn})`).join(', ')}
        </p>
      )}
      {showAhead && ahead.expiring.length > 0 && (
        <div className="alert alert-warning">
          <strong>Lapsing this week:</strong>{' '}
          {ahead.expiring.map((e) => `${e.label} (${e.expiresOn})`).join(', ')}
        </div>
      )}

      {/* Each line carries WHY it is here. A list headed "needs attention"
          that does not say why cannot be argued with, and the first thing a
          reader does with a list they cannot argue with is stop reading it. */}
      {showAttention && ahead.neglected.items.length > 0 ? (
        <>
          {/* An h4 under the week's h3 when both are here; its own h3 when it
              is the whole of what was asked for, so it is not a subheading of
              a heading that is not on the page. */}
          {showAhead ? (
            <h4>
              Needs attention
              {ahead.neglected.total > ahead.neglected.items.length
                && <span className="hint"> · showing {ahead.neglected.items.length} of {ahead.neglected.total}</span>}
            </h4>
          ) : (
            <h3>
              Needs attention
              {ahead.neglected.total > ahead.neglected.items.length
                && <span className="hint"> · showing {ahead.neglected.items.length} of {ahead.neglected.total}</span>}
            </h3>
          )}
          <ul className="report-open-list">
            {ahead.neglected.items.map((n) => (
              <li key={`${n.kind}-${n.id}`}>
                <Link to={n.href}>
                  <span className="pill">{NEGLECT_LABEL[n.kind] || n.kind}</span>{' '}{n.title}
                </Link>
                <span className="hint">{' — '}{n.why}</span>
              </li>
            ))}
          </ul>
        </>
      ) : showAttention && (
        // Said out loud. An empty section reads as a section that failed to
        // load; this one is the good outcome and should look like it. Only
        // when it was asked for, though — it is a verdict, and a report that
        // was not asked to check has not earned one.
        <p className="hint">
          {showAhead ? 'Nothing is sitting untouched.'
            : 'Needs attention — nothing is sitting untouched.'}
        </p>
      )}
    </div>
  );
}

// What the trail's four verbs mean in a sentence. The stored word is the
// smallest thing that identifies the act; this is what a principal reads.
const TRAIL_VERB = {
  reveal: 'opened',
  create: 'added',
  update: 'changed',
  delete: 'removed',
  mail_grant: 'granted mail access —',
  mail_revoke: 'took back mail access —',
  mail_delete: 'deleted the correspondence —',
  mail_purge: 'destroyed the correspondence —',
  grant: 'granted a one-time pass —',
  duress_cleared: 'cleared a duress signal —',
};

/**
 * Who opened what is held for you.
 *
 * ONLY ON THE PRINCIPAL'S OWN COPY. The counts above say a document was looked
 * at three times; this says which document, and the server sends it to nobody
 * else — see routes/report.js. So the absence of this section is the rule
 * working, not a section that failed to load, and the screen never renders an
 * empty shell where it would be.
 */
function AccessTrail({ trail }) {
  return (
    <div className="report-trail">
      <h3>Who looked at what</h3>
      {trail.entries.length === 0 ? (
        // The good outcome, said out loud. An empty box under this heading
        // reads as a log that broke rather than a quiet fortnight.
        <p className="hint">Nobody opened anything held for you in this period.</p>
      ) : (
        <>
          <ul className="report-open-list">
            {trail.entries.map((e) => (
              <li key={e.id}>
                <strong>{e.actorName}</strong>{' '}
                {TRAIL_VERB[e.action] || e.action}{' '}
                {e.subject || e.field || 'something since removed'}
                <span className="hint">
                  {' — '}{new Date(e.at).toLocaleString(undefined, {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ul>
          {trail.more && (
            <p className="hint">
              More than is shown here. Ask for a shorter period to see the rest.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function Report() {
  const { user } = useAuth();
  const [ownerId, setOwnerId] = useState(null);
  const [back, setBack] = useState(1);
  // Which sections are wanted. Empty is not "none" — it is "no preference",
  // which the server reads as the whole report. See lib/reportSections.js.
  const [picked, setPicked] = useState([]);
  // A period somebody asked for, which wins over the week stepper while it is
  // set. Held as the two dates rather than as a mode flag, so "is this a
  // custom period" has one answer and not two that can disagree.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // Whose copy to download. Only offered to somebody who may see everyone —
  // and the server ignores it for anybody else rather than trusting this.
  const [who, setWho] = useState('');

  useEffect(() => { resolveActivePrincipal(user).then(setOwnerId); }, [user]);

  // ONE PLACE THAT SAYS WHICH PERIOD, and every fetch and both download links
  // are built from it. Written twice, the screen would eventually show one
  // fortnight and hand somebody a file covering another — which is worse than
  // either being wrong, because nothing on the page would say so.
  const period = applied
    ? `from=${encodeURIComponent(applied.from)}&to=${encodeURIComponent(applied.to)}`
    : `week=${back}`;

  // WHICH PARTS. Empty means the whole report, which is both the default and
  // the thing the parameter is left off for — sending `sections=` with every
  // id in it would produce the same document while making every link longer
  // and every bookmark stale the day a section is added.
  const parts = picked.length ? `&sections=${picked.join(',')}` : '';

  // ONLY THE ANSWER TO THE PERIOD STILL BEING ASKED FOR. The same shape that
  // was showing one day's entries under another day's heading on the itinerary:
  // change the dates twice in quick succession, or change them while the first
  // fetch is still out, and whichever request ANSWERED last won — regardless of
  // which was asked last. Here it would put one fortnight's figures under
  // another fortnight's dates, and the download links beside them are built
  // from `period`, so the file and the table would disagree with each other
  // while both looked settled. A report somebody forwards to an accountant is
  // the last place for that.
  const reqRef = useRef(0);
  useEffect(() => {
    if (!ownerId) return;
    const seq = ++reqRef.current;
    setData(null);
    setError('');
    api.get(`/report/${ownerId}?${period}${parts}`)
      .then((r) => { if (seq === reqRef.current) setData(r); })
      .catch((e) => { if (seq === reqRef.current) setError(e.message); });
  }, [ownerId, period, parts]);

  if (!data) {
    return (
      <AppShell title="Report">
        <p className="hint">{error || 'Loading…'}</p>
        {/* Reachable from the failure, not only from the success. A refused
            period used to leave the screen on "Loading…" for ever with the
            picker gone, and the only way back was the browser's own back
            button. */}
        {error && applied && (
          <button className="btn btn-sm" type="button"
            onClick={() => { setApplied(null); setError(''); }}>
            Back to whole weeks
          </button>
        )}
      </AppShell>
    );
  }

  const open = data.stillOpen || {};
  const anythingOpen = open.approvalsWaiting || open.tasksOverdue || open.recordsOpen;
  // What the SERVER says this document is made of, not what is ticked here.
  // The two are normally the same, and when they briefly are not — a request
  // in flight — the screen should draw what it was actually given.
  const inDoc = (id) => !data.sections || data.sections.includes(id);
  // Built once so the two links cannot drift into asking for different weeks.
  const query = `?${period}${parts}${who ? `&person=${encodeURIComponent(who)}` : ''}`;

  const custom = !!data.window.custom;

  return (
    <AppShell title="Report" guide="report">
      {error && <div className="alert alert-error">{error}</div>}

      <div className="report-head">
        <div>
          <h3 style={{ margin: 0 }}>
            {data.window.startDate} to {data.window.endDate}
          </h3>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            {custom
              ? 'The period you asked for'
              : back === 0 ? 'The week so far' : back === 1 ? 'Last week' : `${back} weeks ago`}
            {' · '}
            {custom
              ? `dates read in ${data.window.timeZone}`
              : `weeks run Monday to Sunday in ${data.window.timeZone}`}
          </p>
        </div>
        {/* The stepper is for the question "how was last week", which is most
            of them. It steps out of the way rather than disappearing once
            somebody asks for dates, so getting back is one click. */}
        {!custom && (
          <div className="report-nav">
            <button className="btn btn-sm" type="button" onClick={() => setBack((b) => Math.min(b + 1, 52))}>
              ← Earlier
            </button>
            <button className="btn btn-sm" type="button" disabled={back === 0}
              onClick={() => setBack((b) => Math.max(b - 1, 0))}>
              Later →
            </button>
          </div>
        )}
      </div>

      {/* ANY STRETCH OF DAYS, ON DEMAND. A Monday-to-Sunday week is the right
          default and the wrong only option: "how did the quarter go", "what
          happened while I was in Geneva" and "give me March" are none of them
          a whole number of weeks back from today. */}
      <form
        className="report-period"
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to) setApplied({ from, to });
        }}
      >
        <span className="hint">Or any dates:</span>
        <label className="sr-only" htmlFor="rp-from">From</label>
        <input id="rp-from" type="date" value={from} max={to || undefined}
          onChange={(e) => setFrom(e.target.value)} />
        <span className="hint">to</span>
        <label className="sr-only" htmlFor="rp-to">To</label>
        <input id="rp-to" type="date" value={to} min={from || undefined}
          onChange={(e) => setTo(e.target.value)} />
        <button className="btn btn-sm" type="submit" disabled={!from || !to}>
          Run it
        </button>
        {custom && (
          <button className="btn btn-sm" type="button"
            onClick={() => { setApplied(null); setFrom(''); setTo(''); }}>
            Back to weeks
          </button>
        )}
      </form>

      {/* WHICH REPORT. The whole thing is the default and stays the default:
          nothing ticked means every part, segmented, which is what anybody
          means by "the report". Ticking is for the times somebody wants one
          part — an accountant who needs the counts, a principal checking
          their own custody trail — and the document then says on its face
          that it is a part, because a forwarded file whose reader cannot tell
          an omitted section from an empty one misleads by its shape. */}
      {(data.sectionsAvailable || []).length > 1 && (
        <div className="report-parts">
          <span className="hint">Which parts:</span>
          <button
            className={'btn btn-sm' + (picked.length === 0 ? ' is-on' : '')}
            type="button" aria-pressed={picked.length === 0}
            onClick={() => setPicked([])}
          >
            All of it
          </button>
          {data.sectionsAvailable.map((sec) => {
            const on = picked.includes(sec.id);
            return (
              <button
                key={sec.id}
                className={'btn btn-sm' + (on ? ' is-on' : '')}
                type="button" aria-pressed={on} title={sec.what}
                onClick={() => setPicked((was) => (on
                  ? was.filter((x) => x !== sec.id)
                  : [...was, sec.id]))}
              >
                {sec.label}
              </button>
            );
          })}
        </div>
      )}
      {picked.length > 0 && (
        <p className="hint report-parts-note">
          Showing {picked.length} of {(data.sectionsAvailable || []).length} parts. The document and
          the spreadsheet carry the same choice, and say on the first line that they are a part.
        </p>
      )}

      {/* PLAIN LINKS, not fetch-and-blob. The session is a cookie and the
          server sends Content-Disposition, so the browser saves the file
          itself — which also means it works on a phone, where a blob URL
          built in JavaScript often does not. `download` is deliberately NOT
          set: the server names the file, and letting the markup override it
          would put the naming rule in two places. */}
      <div className="report-download">
        <span className="hint">Take it away:</span>
        {data.canSeeEveryone && (
          <select
            aria-label="Whose report" value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">Everyone</option>
            {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <a className="btn btn-sm" href={`/api/report/${ownerId}/export${query}`}>
          Document
        </a>
        <a className="btn btn-sm" href={`/api/report/${ownerId}/export${query}&format=csv`}>
          Spreadsheet
        </a>
      </div>

      {/* THE HALF THE PRINCIPAL IS ACTUALLY READING FOR. A list of things
          completed is a flattering document; what is still outstanding is the
          part that changes what somebody does on Monday. Counted as it stands
          now rather than as it stood on Sunday night, so chasing it is not
          chasing something already done. */}
      {inDoc('open') && anythingOpen ? (
        <div className="alert alert-warning report-open">
          <strong>Still open right now.</strong>{' '}
          {[
            open.approvalsWaiting && `${open.approvalsWaiting} request${open.approvalsWaiting === 1 ? '' : 's'} waiting on you`,
            open.tasksOverdue && `${open.tasksOverdue} task${open.tasksOverdue === 1 ? '' : 's'} past their date`,
            open.recordsOpen && `${open.recordsOpen} record${open.recordsOpen === 1 ? '' : 's'} nobody has answered`,
          ].filter(Boolean).join(' · ')}

          {/* THE COUNT WAS A DEAD END.
              "3 records nobody has answered" told the reader they had a
              problem and left them to go hunting through rooms for it, which
              is the exact work this screen exists to save. Each one is now the
              line itself, linked to the message rather than to the foot of the
              room it is in.
              Oldest first: a decision nobody answered three weeks ago is more
              wrong than one filed this morning. */}
          {(open.records || []).length > 0 && (
            <ul className="report-open-list">
              {open.records.map((r) => (
                <li key={r.id}>
                  <Link to={`/threads/${r.threadId}#m-${r.id}`}>
                    <span className={`pill pill-${r.recordType}`}>{RECORD_LABEL[r.recordType] || r.recordType}</span>
                    {' '}{r.body}
                  </Link>
                  <span className="hint">
                    {' — '}{r.authorName} in {r.threadName}
                    {r.spaceName ? ` · ${r.spaceName}` : ''}
                  </span>
                </li>
              ))}
              {open.moreRecords > 0 && (
                <li className="hint">and {open.moreRecords} more</li>
              )}
            </ul>
          )}
        </div>
      ) : (
        <div className="alert alert-success report-open">
          Nothing outstanding — no requests waiting, no work past its date.
        </div>
      )}

      {/* Sent only to the account holder. Rendered only when it arrives, so
          somebody who is not entitled to it sees no empty section hinting
          that one exists. */}
      {inDoc('trail') && data.accessTrail && <AccessTrail trail={data.accessTrail} />}

      {(inDoc('ahead') || inDoc('attention')) && data.ahead
        && <WeekAhead ahead={data.ahead} ownerId={ownerId}
             showAhead={inDoc('ahead')} showAttention={inDoc('attention')} />}

      {data.scope === 'self' && (
        <p className="hint">
          This is your own week. What everyone else did is for the principal and
          their Chief of Staff to see.
        </p>
      )}
      {data.scope === 'office' && !data.isPrincipal && (
        <p className="hint">
          You are seeing the whole office because you are its Chief of Staff.
        </p>
      )}

      {data.people.length === 0 && (
        <div className="empty-state">
          {/* Told to whoever can actually act on it. Sending a Chief of Staff
              to a Team screen that belongs to somebody else is advice they
              cannot take. */}
          {data.isPrincipal
            ? 'Nobody is working with you on Kairos yet. Invite a PA, EA or Chief of Staff from Team and their week will show here.'
            : 'Nothing to show for this week.'}
        </div>
      )}

      {inDoc('office') && data.people.map((p) => <PersonCard key={p.id} person={p} />)}
    </AppShell>
  );
}
