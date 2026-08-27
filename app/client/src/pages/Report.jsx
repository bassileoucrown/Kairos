import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import { useAuth } from '../lib/AuthContext.jsx';

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

export default function Report() {
  const { user } = useAuth();
  const [ownerId, setOwnerId] = useState(null);
  const [back, setBack] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

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
        </div>
      ) : (
        <div className="alert alert-success report-open">
          Nothing outstanding — no requests waiting, no work past its date.
        </div>
      )}

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
