import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { useAsk } from '../components/Ask.jsx';

// The archive: what the office decided was worth keeping after the rooms it
// was said in had finished.
//
// TWO KINDS OF THING UNDER ONE HEADING, and they got here by different routes
// because they are different problems. A kept message is a COPY, taken out of
// a conversation deliberately so that deleting the conversation cannot take it
// — which is the whole reason this screen exists. An archived document is the
// original, simply put away: nothing was ever going to delete it, so copying
// it would have meant two passport numbers where there should be one.
//
// The screen does not make the reader care about that distinction. It reads as
// one archive, which is what it is from where they are standing.

function whenText(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/**
 * One thing somebody took out of a conversation and kept.
 *
 * The provenance line is the point of the whole card. A saved fragment with no
 * answer to "who said this, where, and when" is a note to nobody — and by the
 * time anyone reads this the room it came from may not exist to be asked.
 */
function KeptCard({ item, onNote, onRemove }) {
  return (
    <div className="card kept-card">
      <div className="kept-body">{item.body}</div>
      {item.note && <div className="kept-note">{item.note}</div>}
      <div className="kept-meta hint">
        {item.saidByName || 'Someone'}
        {item.saidAt ? ` · ${whenText(item.saidAt)}` : ''}
        {item.threadName ? ` · ${item.threadName}` : ''}
        {item.spaceName ? ` (${item.spaceName})` : ''}
      </div>
      <div className="kept-meta hint">
        Kept by {item.keptByName || 'someone'} on {whenText(item.keptAt)}
        {/* Said plainly, because it is the difference between this being a
            record and being a stale copy. An archived line is the words as
            they were when somebody saved them. */}
        {' '}· held as it read then
      </div>
      <div className="kept-buttons">
        {/* Offered only where there is still something to open. The rooms this
            came from are expected to be gone — that is what keeping is for —
            and a link into a deleted conversation would be the one dead end an
            archive must not have. */}
        {item.sourceLive && item.sourceThreadId && (
          <Link className="btn btn-sm" to={`/threads/${item.sourceThreadId}`}>
            Open the conversation
          </Link>
        )}
        <button className="btn btn-sm" type="button" onClick={() => onNote(item)}>
          {item.note ? 'Edit the note' : 'Add a note'}
        </button>
        <button className="btn btn-danger btn-sm" type="button" onClick={() => onRemove(item)}>
          Remove
        </button>
      </div>
    </div>
  );
}

export default function Archive() {
  const { user } = useAuth();
  const [ask, askDialog] = useAsk();
  const [ownerId, setOwnerId] = useState(null);
  const [data, setData] = useState(null);
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { resolveActivePrincipal(user).then(setOwnerId); }, [user]);

  function load() {
    if (!ownerId) return Promise.resolve();
    return Promise.all([
      api.get(`/archive/${ownerId}`),
      // Documents come from the essentials route rather than this one, because
      // the masking and the access log live there and must not be spelled
      // twice. See routes/archive.js.
      api.get(`/essentials/${ownerId}/archived`).catch(() => ({ essentials: [] })),
    ]).then(([a, e]) => { setData(a); setDocs(e.essentials || []); })
      .catch((err) => setError(err.message));
  }
  useEffect(() => { load(); }, [ownerId]);

  async function note(item) {
    const next = await ask({
      title: 'Why is this kept?',
      label: 'Note',
      hint: 'For whoever reads this in a year — including you.',
      initial: item.note || '',
      multiline: true,
      // Clearing a note is a legitimate answer, so an empty box has to be
      // accepted rather than treated as backing out.
      optional: true,
      confirmLabel: 'Save',
    });
    if (next === null || next === undefined) return;
    try { await api.patch(`/archive/${ownerId}/${item.id}`, { note: next }); load(); }
    catch (err) { setError(err.message); }
  }

  async function remove(item) {
    // The last copy. There is no further tier to demote it to, so the warning
    // says so rather than asking a vague "are you sure".
    if (!window.confirm('Remove this from the archive? This is the only copy left — it cannot be recovered.')) return;
    try { await api.del(`/archive/${ownerId}/${item.id}`); load(); }
    catch (err) { setError(err.message); }
  }

  async function restoreDoc(id) {
    try { await api.del(`/essentials/${ownerId}/${id}/archive`); load(); }
    catch (err) { setError(err.message); }
  }

  if (!data) {
    return (
      <AppShell title="Archive">
        <p className="hint">{error || 'Loading…'}</p>
      </AppShell>
    );
  }

  // The same answer a passport gets for a scheduling-only remit: there is
  // nothing here for you, rather than something being withheld from you.
  if (!data.canRead) {
    return (
      <AppShell title="Archive">
        <div className="empty-state">
          Your remit here covers scheduling, so the archive is not shown.
        </div>
      </AppShell>
    );
  }

  const kept = data.kept || [];
  const documents = docs || [];

  return (
    <AppShell title="Archive">
      {askDialog}
      {error && <div className="alert alert-error">{error}</div>}

      <p className="hint" style={{ marginBottom: 16 }}>
        Things kept out of conversations, and documents put away. Everything here
        survives the room it came from being archived or deleted.
      </p>

      <h3>Kept from conversations</h3>
      {kept.length === 0 ? (
        <div className="empty-state">
          Nothing kept yet. In any conversation, tap a message and choose
          {' '}<strong>Keep</strong> — useful before a space is closed or deleted, so
          the things that mattered are not lost with it.
        </div>
      ) : kept.map((item) => (
        <KeptCard key={item.id} item={item} onNote={note} onRemove={remove} />
      ))}

      <h3 style={{ marginTop: 24 }}>Documents put away</h3>
      {documents.length === 0 ? (
        <div className="empty-state">
          No documents archived. An expired passport or a policy that has lapsed can be
          archived from <Link to="/dashboard?tab=essentials">Essentials</Link> — it leaves
          the live list and stops the renewal reminders, and stays readable here.
        </div>
      ) : documents.map((e) => (
        <div className="card ess-row" key={e.id}>
          <div className="ess-main">
            <div className="ess-label">
              {e.label}
              {e.subjectName && <span className="hint"> · {e.subjectName}</span>}
            </div>
            {/* Masked exactly as it is in the live vault. Archiving a passport
                does not make its number less of a passport number, and reading
                one still costs a step-up and is still logged. */}
            <div className={'ess-value' + (e.masked ? ' is-masked' : '')}>{e.value}</div>
            <div className="ess-meta">
              <span className="hint">
                Put away {whenText(e.archivedAt)}
                {e.expiresOn ? ` · expired ${e.expiresOn}` : ''}
              </span>
            </div>
          </div>
          <div className="ess-buttons">
            <button className="btn btn-sm" type="button" onClick={() => restoreDoc(e.id)}>
              Put back in the vault
            </button>
          </div>
        </div>
      ))}
    </AppShell>
  );
}
