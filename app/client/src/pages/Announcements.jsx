import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell.jsx';
import { api } from '../lib/api.js';
import { BRAND_FULL } from '../lib/brand.js';

// Notices, one direction.
//
// The useful half of "a community for PAs" without the half that would hurt.
// A forum where assistants discuss their principals, from accounts traceable
// to named executives, runs against everything else in this app — and no
// permission check catches that kind of leak, because the person posting does
// not experience it as one. A broadcast channel keeps the information and the
// notices, carries no moderation surface, and cannot be turned into a
// directory of who is here.

function when(iso) {
  if (!iso) return 'Draft';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

function Composer({ audiences, editing, onDone, onCancel }) {
  const [form, setForm] = useState(editing || { title: '', body: '', audience: 'everyone' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(publish) {
    setError(''); setBusy(true);
    try {
      if (editing) {
        await api.patch(`/announcements/${editing.id}`, form);
        if (publish) await api.post(`/announcements/${editing.id}/publish`);
      } else {
        await api.post('/announcements', { ...form, publish });
      }
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <form className="card ann-composer" onSubmit={(e) => { e.preventDefault(); save(true); }}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="field">
        <label htmlFor="ann-title">Title</label>
        <input
          id="ann-title" type="text" value={form.title} required maxLength={160}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="ann-body">Notice</label>
        <textarea
          id="ann-body" rows={5} value={form.body} required
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="ann-audience">Who sees it</label>
        <select
          id="ann-audience" value={form.audience}
          onChange={(e) => setForm({ ...form, audience: e.target.value })}
        >
          {audiences.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <p className="hint">
          Aimed rather than blasted. A channel nobody can mute stays worth reading only if
          what arrives is meant for the person reading it.
        </p>
      </div>
      <div className="ann-composer-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Publish'}
        </button>
        <button className="btn btn-sm" type="button" disabled={busy} onClick={() => save(false)}>
          Save as draft
        </button>
        {onCancel && <button className="btn btn-danger btn-sm" type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

export default function Announcements() {
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState('');
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState(null);

  async function load() {
    try {
      const d = await api.get('/announcements');
      setData(d);
      if (d.canPublish) setDrafts((await api.get('/announcements/drafts')).announcements);
      // Opening the page is reading it. Asking someone to tick off a notice
      // they have just read is make-work.
      for (const a of d.announcements.filter((x) => !x.read)) {
        api.post(`/announcements/${a.id}/read`).catch(() => {});
      }
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);

  async function act(id, path) {
    setError('');
    try {
      if (path === 'delete') await api.del(`/announcements/${id}`);
      else await api.post(`/announcements/${id}/${path}`);
      load();
    } catch (err) { setError(err.message); }
  }

  if (!data) {
    return <AppShell title="Notices" active="notices"><p className="hint">Loading…</p></AppShell>;
  }

  return (
    <AppShell
      title="Notices"
      active="notices"
      guide="notices"
      actions={data.canPublish && !composing && !editing
        ? <button className="btn btn-primary btn-sm" type="button" onClick={() => setComposing(true)}>Write one</button>
        : null}
    >
      {error && <div className="alert alert-error">{error}</div>}

      {/* Honest about not being set up, and only to the person who could act
          on it. Everyone else just sees a quiet channel. */}
      {data.canPublish && !data.configured && (
        <div className="alert alert-warning">
          No announcement authors are configured for this deployment, so nothing can be
          published. Set ANNOUNCEMENT_AUTHORS to the email addresses allowed to post.
        </div>
      )}

      {composing && (
        <Composer
          audiences={data.audiences || []}
          onDone={() => { setComposing(false); load(); }}
          onCancel={() => setComposing(false)}
        />
      )}
      {editing && (
        <Composer
          audiences={data.audiences || []}
          editing={editing}
          onDone={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {data.announcements.length === 0 && !composing && (
        <div className="empty-state">
          Nothing yet. This is where notices from {BRAND_FULL} arrive — nobody else can post
          here, and there is no discussion to keep up with.
        </div>
      )}

      {data.announcements.map((a) => (
        <article className={'card ann' + (a.read ? '' : ' is-new')} key={a.id}>
          <div className="ann-head">
            <h2 className="ann-title">{a.title}</h2>
            {!a.read && <span className="pill is-warn">New</span>}
          </div>
          <div className="ann-meta">
            {when(a.publishedAt)} · {a.authorName}
            {a.audience !== 'everyone' && <> · {a.audienceLabel}</>}
          </div>
          <div className="ann-body">{a.body}</div>
        </article>
      ))}

      {data.canPublish && drafts && (
        <section className="ws-section">
          <h2 className="ws-heading">Everything you've written</h2>
          {drafts.length === 0 && <div className="empty-state">Nothing written yet.</div>}
          {drafts.map((a) => (
            <div className="card ann-admin" key={a.id}>
              <div>
                <div className="name">
                  {a.title}{' '}
                  <span className={'pill' + (a.publishedAt ? '' : ' is-off')}>
                    {a.publishedAt ? 'Published' : 'Draft'}
                  </span>
                </div>
                <div className="meta">
                  {a.audienceLabel} · {when(a.publishedAt)}
                  {a.publishedAt && ` · read by ${a.readCount}`}
                </div>
              </div>
              <div className="ann-admin-actions">
                <button className="btn btn-sm" type="button" onClick={() => setEditing(a)}>Edit</button>
                {a.publishedAt
                  ? <button className="btn btn-sm" type="button" onClick={() => act(a.id, 'withdraw')}>Withdraw</button>
                  : <button className="btn btn-primary btn-sm" type="button" onClick={() => act(a.id, 'publish')}>Publish</button>}
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  onClick={() => { if (window.confirm('Delete this permanently?')) act(a.id, 'delete'); }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </AppShell>
  );
}
