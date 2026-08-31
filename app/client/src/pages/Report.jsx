import { useEffect, useState } from 'react';
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

function WeekAhead({ ahead, ownerId }) {
  const [read, setRead] = useState('');
  const due = ahead.tasksDue.length + ahead.moreTasksDue;
  const stages = ahead.stagesDue.length + ahead.moreStagesDue;
  return (
    <div className="report-ahead">
      <h3>
        The week ahead
        <span className="hint"> · {ahead.window.startDate} to {ahead.window.endDate}</span>
      </h3>

      {/* The counts are below. This is the observation on top of them — where
          the week is tight, and what would have to move if something slipped. */}
      <div className="assist-control" style={{ margin: '0 0 10px' }}>
        <AssistButton
          feature="ai_week_ahead"
          path={`/assist/${ownerId}/week-ahead`}
          label="Read the week"
          onResult={(d) => setRead(d.empty ? 'There is nothing in the week ahead yet.' : d.text)}
        />
      </div>
      {read && <div className="assist-out">{read}</div>}

      <div className="report-tiles">
        <div><strong>{ahead.appointments}</strong><span>appointment{ahead.appointments === 1 ? '' : 's'}</span></div>
        <div><strong>{due}</strong><span>task{due === 1 ? '' : 's'} fall due</span></div>
        <div><strong>{stages}</strong><span>stage{stages === 1 ? '' : 's'} fall due</span></div>
      </div>

      {ahead.trips.length > 0 && (
        <p className="hint">
          Away: {ahead.trips.map((t) => `${t.name} (${t.startsOn}–${t.endsOn})`).join(', ')}
        </p>
      )}
      {ahead.expiring.length > 0 && (
        <div className="alert alert-warning">
          <strong>Lapsing this week:</strong>{' '}
          {ahead.expiring.map((e) => `${e.label} (${e.expiresOn})`).join(', ')}
        </div>
      )}

      {/* Each line carries WHY it is here. A list headed "needs attention"
          that does not say why cannot be argued with, and the first thing a
          reader does with a list they cannot argue with is stop reading it. */}
      {ahead.neglected.items.length > 0 ? (
        <>
          <h4>
            Needs attention
            {ahead.neglected.total > ahead.neglected.items.length
              && <span className="hint"> · showing {ahead.neglected.items.length} of {ahead.neglected.total}</span>}
          </h4>
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
      ) : (
        // Said out loud. An empty section reads as a section that failed to
        // load; this one is the good outcome and should look like it.
        <p className="hint">Nothing is sitting untouched.</p>
      )}
    </div>
  );
}

export default function Report() {
  const { user } = useAuth();
  const [ownerId, setOwnerId] = useState(null);
  const [back, setBack] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // Whose copy to download. Only offered to somebody who may see everyone —
  // and the server ignores it for anybody else rather than trusting this.
  const [who, setWho] = useState('');

  useEffect(() => { resolveActivePrincipal(user).then(setOwnerId); }, [user]);

  useEffect(() => {
    if (!ownerId) return;
    setData(null);
    api.get(`/report/${ownerId}?week=${back}`).then(setData).catch((e) => setError(e.message));
  }, [ownerId, back]);

  if (!data) {
    return <AppShell title="Weekly report"><p className="hint">{error || 'Loading…'}</p></AppShell>;
  }

  const open = data.stillOpen || {};
  const anythingOpen = open.approvalsWaiting || open.tasksOverdue || open.recordsOpen;
  // Built once so the two links cannot drift into asking for different weeks.
  const query = `?week=${back}${who ? `&person=${encodeURIComponent(who)}` : ''}`;

  return (
    <AppShell title="Weekly report">
      {error && <div className="alert alert-error">{error}</div>}

      <div className="report-head">
        <div>
          <h3 style={{ margin: 0 }}>
            {data.window.startDate} to {data.window.endDate}
          </h3>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            {back === 0 ? 'The week so far' : back === 1 ? 'Last week' : `${back} weeks ago`}
            {' · '}weeks run Monday to Sunday in {data.window.timeZone}
          </p>
        </div>
        <div className="report-nav">
          <button className="btn btn-sm" type="button" onClick={() => setBack((b) => Math.min(b + 1, 52))}>
            ← Earlier
          </button>
          <button className="btn btn-sm" type="button" disabled={back === 0}
            onClick={() => setBack((b) => Math.max(b - 1, 0))}>
            Later →
          </button>
        </div>
      </div>

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
      {anythingOpen ? (
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

      {data.ahead && <WeekAhead ahead={data.ahead} ownerId={ownerId} />}

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

      {data.people.map((p) => <PersonCard key={p.id} person={p} />)}
    </AppShell>
  );
}
