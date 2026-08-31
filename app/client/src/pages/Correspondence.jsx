import { useEffect, useState } from 'react';
import AppShell, { resolveActivePrincipal } from '../components/AppShell.jsx';
import AssistButton from '../components/AssistButton.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

// Correspondence an assistant handles on a principal's behalf.
//
// WHAT THIS SCREEN IS NOT. It is not an inbox, and it must not grow into one.
// Kairos holds only what the principal decided should cross the boundary — see
// lib/mailbox.js — so this shows that, and never pretends to be the mailbox.
//
// WHAT IT IS FOR. The thing an assistant actually does all day is decide: what
// needs the principal, what they can answer themselves, what is waiting on
// somebody else, and what has gone quiet. A mail client models none of that;
// it has read and unread. So the state a thread carries is the screen.
//
// THE CONTROLS SHOWN ARE THE ONES THIS PERSON HAS. The server sends `may` per
// account, so somebody granted reading is not offered a delete the server
// would refuse — a button that always fails is worse than one that is absent.

const STATES = [
  ['open', 'Needs doing'],
  ['waiting', 'Waiting on them'],
  ['done', 'Done'],
];

const VERDICT_LABEL = {
  needs_principal: 'Needs the principal',
  assistant_can_answer: 'You can answer',
  can_wait: 'Can wait',
  no_action: 'Nothing needed',
};

// A draft, and only ever a draft.
//
// WHERE IT SITS IS THE POINT. Triage says a message needs answering; the thing
// you do next is answer it. A drafting box on a separate AI page would mean
// carrying the answer back to the correspondence by hand, which is how a
// feature ends up unused.
//
// AND IT STOPS AT WORDS. Kairos does not send mail on this deployment — the
// grant model carries who may, and nothing consumes it yet — so this hands
// back text to copy and says so. The alternative, a Send button that quietly
// did nothing, is the exact thing this codebase refuses to ship.
function ReplyDraft({ ownerId, thread, messages }) {
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState(null);

  // What the reply is answering. The last thing that arrived, not the whole
  // thread: a model given forty messages writes about all forty.
  const context = [...messages].reverse().find((m) => !m.deleted)?.body || '';

  return (
    <div className="mail-reply">
      <div className="field">
        {/* Scoped to the thread. Every open thread renders one of these, and a
            shared id would point every label at the first box on the page. */}
        <label htmlFor={`reply-${thread.id}`}>What should the reply do?</label>
        <input
          id={`reply-${thread.id}`} type="text" value={instruction}
          placeholder="Decline, warmly, and offer March"
          onChange={(e) => setInstruction(e.target.value)}
        />
      </div>
      <div className="movement-inline">
        <AssistButton
          feature="ai_reply"
          path={`/assist/${ownerId}/reply`}
          body={{ instruction, context: `${thread.subject}\n\n${context}` }}
          label="Draft a reply"
          onResult={setDraft}
        />
      </div>
      {draft?.text && (
        <div className="assist-out">
          <div className="assist-out-head">
            A draft — nothing has been sent
            {/* Said out loud, because it is the difference between a draft
                that sounds like the principal and one that sounds like an
                app. Without samples it is the second, and the reader should
                know which they are holding. */}
            {draft.inVoice === false && ' · not yet in their voice, there is nothing written to learn from'}
          </div>
          {draft.text}
        </div>
      )}
    </div>
  );
}

function when(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

export default function Correspondence() {
  const { user } = useAuth();
  const [ownerId, setOwnerId] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [inbound, setInbound] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [threads, setThreads] = useState([]);
  const [quarantined, setQuarantined] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [verdicts, setVerdicts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { resolveActivePrincipal(user).then(setOwnerId); }, [user]);

  useEffect(() => {
    if (!ownerId) return;
    api.get(`/mail/${ownerId}/accounts`)
      .then((d) => {
        setAccounts(d.accounts || []);
        setInbound(d.inbound || null);
        if (!accountId && d.accounts?.length) setAccountId(d.accounts[0].id);
      })
      .catch((e) => setError(e.message));
  }, [ownerId]);

  const account = (accounts || []).find((a) => a.id === accountId) || null;

  function load() {
    if (!ownerId || !accountId) return;
    const base = `/mail/${ownerId}/accounts/${accountId}/threads`;
    api.get(base).then((d) => setThreads(d.threads || [])).catch((e) => setError(e.message));
    api.get(`${base}?quarantined=1`).then((d) => setQuarantined(d.threads || [])).catch(() => {});
  }
  useEffect(() => { load(); setOpenId(null); setVerdicts(null); }, [ownerId, accountId]);

  useEffect(() => {
    if (!openId) { setMessages([]); return; }
    api.get(`/mail/${ownerId}/accounts/${accountId}/threads/${openId}`)
      .then((d) => setMessages(d.messages || []))
      .catch((e) => setError(e.message));
  }, [openId]);

  async function act(fn) {
    setError('');
    try { await fn(); load(); } catch (e) { setError(e.message); }
  }

  if (!accounts) {
    return <AppShell title="Correspondence" active="correspondence"><p className="hint">Loading…</p></AppShell>;
  }

  if (!accounts.length) {
    return (
      <AppShell title="Correspondence" active="correspondence">
        <div className="empty-state">
          No mailbox yet. A principal adds one in Settings, then decides who handles it —
          nobody is in a principal&rsquo;s correspondence just for being their assistant.
        </div>
        {inbound && !inbound.available && (
          <p className="hint">
            Mail cannot arrive on this deployment yet: the inbound route is not configured.
          </p>
        )}
      </AppShell>
    );
  }

  const verdictFor = (id) => (verdicts || []).find((v) => v.id === id);

  return (
    <AppShell title="Correspondence" active="correspondence">
      {error && <div className="alert alert-error">{error}</div>}

      {accounts.length > 1 && (
        <select
          aria-label="Which mailbox" value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label || a.address}</option>)}
        </select>
      )}

      <div className="assist-control" style={{ margin: '10px 0' }}>
        <AssistButton
          feature="ai_triage"
          path={`/assist/${ownerId}/mail/${accountId}/triage`}
          label="Sort this out"
          onResult={(d) => setVerdicts(d.verdicts || [])}
        />
        {verdicts && verdicts.length === 0 && (
          <span className="hint">Nothing open to sort.</span>
        )}
      </div>

      {/* Held, not dropped and not accepted. Dropping loses a first approach
          from somebody who matters; accepting lets anybody who learns the
          address put things in front of a principal. */}
      {quarantined.length > 0 && (
        <div className="alert alert-warning">
          <strong>{quarantined.length} from senders the office does not know.</strong>
          {quarantined.map((t) => (
            <div className="movement-line" key={t.id}>
              <span>{t.correspondentEmail} — {t.subject}</span>
              {account?.may?.organise && (
                <button
                  className="btn btn-sm" type="button"
                  onClick={() => act(() => api.patch(
                    `/mail/${ownerId}/accounts/${accountId}/threads/${t.id}`,
                    { releaseQuarantine: true },
                  ))}
                >
                  Let it through
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {threads.length === 0 && <div className="empty-state">Nothing in this mailbox.</div>}

      {threads.map((t) => {
        const v = verdictFor(t.id);
        return (
          <div className="card mail-thread" key={t.id}>
            <button className="mail-open" type="button" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
              <div>
                <strong>{t.subject}</strong>
                <div className="meta">{t.correspondentName} · {when(t.lastAt)}</div>
              </div>
              <span className={`pill${t.state === 'waiting' ? ' is-warn' : ''}`}>
                {(STATES.find(([s]) => s === t.state) || [, t.state])[1]}
              </span>
            </button>

            {/* The verdict and its reason together. A category with no reason
                cannot be argued with, and a reader who cannot argue stops
                reading. */}
            {v && (
              <p className="hint mail-verdict">
                <strong>{VERDICT_LABEL[v.verdict] || v.verdict}</strong> — {v.why}
              </p>
            )}

            {openId === t.id && (
              <div className="mail-body">
                {messages.map((m) => (
                  <div className="mail-message" key={m.id}>
                    <div className="meta">
                      {m.fromName || m.fromEmail} · {when(m.at)}
                      {m.sentAs && ` · sent ${m.sentAs === 'as' ? 'as the principal' : 'on their behalf'}`}
                    </div>
                    {m.deleted
                      ? <p className="hint">Deleted. The words are gone; the record that it existed is not.</p>
                      : <p>{m.body}</p>}
                  </div>
                ))}

                <ReplyDraft ownerId={ownerId} thread={t} messages={messages} />

                <div className="movement-inline">
                  {account?.may?.organise && STATES.map(([s, label]) => (
                    <button
                      key={s} className="btn btn-sm" type="button" disabled={t.state === s}
                      onClick={() => act(() => api.patch(
                        `/mail/${ownerId}/accounts/${accountId}/threads/${t.id}`, { state: s },
                      ))}
                    >
                      {label}
                    </button>
                  ))}
                  {account?.may?.delete && (
                    <button
                      className="btn btn-sm" type="button"
                      onClick={() => act(() => api.del(
                        `/mail/${ownerId}/accounts/${accountId}/threads/${t.id}`,
                      ))}
                    >
                      Clear it
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </AppShell>
  );
}
