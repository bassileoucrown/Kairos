import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// What the second gate asks for. A code where two-factor is on, because the
// attacker this vault has to survive already knows the password.
// What the step-up asks for, as a proper question in the app. It used to be a
// window.prompt, which showed a password in the clear to whoever was in the
// room and could not be filled by a password manager — on the one screen in
// Kairos that holds passport numbers.
function stepUpAsk(factor, what = 'reveal this') {
  return factor === 'code'
    ? {
      title: 'Confirm it is you',
      label: 'Code from your authenticator',
      hint: `Needed to ${what}. The principal can see that you did.`,
      confirmLabel: 'Confirm',
    }
    : {
      title: 'Confirm it is you',
      label: 'Your password',
      hint: `Needed to ${what}. The principal can see that you did.`,
      secret: true,
      confirmLabel: 'Confirm',
    };
}

function stepUpBody(factor, answer) {
  return factor === 'code' ? { code: answer.trim() } : { password: answer };
}

// Mirrors sensitivityOf in server/lib/essentials.js: a field may override its
// category. Most do not, and the category answers for them.
function sensitivityOf(category, field) {
  return field?.sensitivity || category?.sensitivity;
}

// The things people are asked for and cannot recall.
//
// Sensitive values arrive masked and stay that way until someone deliberately
// asks — which costs a password and is written to a log the principal can
// read. That is the whole design: the screen is safe to have open in a
// meeting, and looking is an act rather than a side effect of navigating.

function ExpiryPill({ essential }) {
  if (!essential.expiresOn) return null;
  if (essential.expiryState === 'expired') {
    return <span className="pill is-off">Expired</span>;
  }
  if (essential.expiryState === 'expiring') {
    return <span className="pill is-warn">{essential.daysUntilExpiry} days left</span>;
  }
  return <span className="hint">Valid to {essential.expiresOn}</span>;
}

function StalePill({ essential }) {
  if (!essential.verifiedAt) return null;
  const days = Math.floor((Date.now() - Date.parse(essential.verifiedAt)) / 86400000);
  // Data entered once and never checked looks authoritative while quietly
  // going out of date — the number may be from the previous passport.
  if (days < 365) return null;
  return <span className="pill is-off">Unconfirmed for {Math.floor(days / 365)}y</span>;
}

import SoonButton from '../../components/SoonButton.jsx';
import { useAsk } from '../../components/Ask.jsx';

export default function EssentialsTab({ ownerId }) {
  // Replaces window.prompt; see components/Ask.jsx.
  const [ask, askDialog] = useAsk();
  const [data, setData] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [formats, setFormats] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revealed, setRevealed] = useState({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ category: 'preferences', field: '', value: '', expiresOn: '' });

  // Arriving from a summary somewhere else — a trip's document warning, most
  // often — which named a document but could not show it. The id in the URL
  // says which row was meant; this scrolls to it and marks it, so the answer
  // to "which passport?" is not left as an exercise.
  const focusId = new URLSearchParams(window.location.search).get('essential');
  useEffect(() => {
    if (!focusId || !data) return;
    const el = document.getElementById(`essential-${focusId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, data]);

  function load() {
    return api.get(`/essentials/${ownerId}`).then(setData).catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (!ownerId) return;
    load();
    api.get('/essentials/catalogue').then((d) => setCatalogue(d.categories)).catch(() => {});
    // The accepted list comes from the server so the file picker and the door
    // can never disagree — a picker that offers .doc and a server that refuses
    // it is a rule discovered by failing.
    api.get('/essentials/formats').then((d) => setFormats(d.accepted || [])).catch(() => {});
  }, [ownerId]);

  // Asks for whatever the server says this account's second gate costs — a
  // code where two-factor is on, the password where it is not. The grace
  // window means a run of reveals at a check-in desk asks once, not five
  // times, so the first attempt is made without credentials and only prompts
  // if the server says it needs them.
  async function reveal(id) {
    setError('');
    try {
      const d = await api.post(`/essentials/${ownerId}/${id}/reveal`, {});
      setRevealed((r) => ({ ...r, [id]: d.essential.value }));
      return;
    } catch (err) {
      if (err.status !== 401) { setError(err.message); return; }
    }
    const answer = await ask(stepUpAsk(data?.stepUpFactor));
    if (!answer) return;
    try {
      const d = await api.post(`/essentials/${ownerId}/${id}/reveal`, stepUpBody(data?.stepUpFactor, answer));
      setRevealed((r) => ({ ...r, [id]: d.essential.value }));
    } catch (err) { setError(err.message); }
  }

  // ---- Documents --------------------------------------------------------
  //
  // ATTACHING IS FILING; OPENING IS REVEALING. That is the whole shape of it
  // on this screen too — putting a passport page in costs nothing beyond
  // choosing it, and taking one out costs exactly what the number beside it
  // costs, down to the same prompt and the same line in the principal's trail.
  //
  // THE DOWNLOAD IS A PLAIN NAVIGATION, not a blob built here. The server
  // names the file and sends it as an attachment, which is the only version of
  // this that reliably saves on a phone — the report export learned the same
  // lesson. The second factor cannot travel in a URL, so the act is a POST
  // that hands back a one-time pass and the navigation spends it.
  async function attach(essentialId, file) {
    setError('');
    if (!file) return;
    try {
      const data64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('That file could not be read.'));
        // The result is a data: URL; the payload is after the comma.
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.readAsDataURL(file);
      });
      const d = await api.post(`/essentials/${ownerId}/${essentialId}/documents`, {
        filename: file.name, mimeType: file.type, data: data64,
      });
      setNotice(d.document.flagNote
        ? `${d.document.filename} attached. ${d.document.flagNote}`
        : `${d.document.filename} attached.`);
      load();
    } catch (err) { setError(err.message); }
  }

  async function openDocument(essentialId, doc) {
    setError('');
    const at = `/essentials/${ownerId}/${essentialId}/documents/${doc.id}`;
    let pass = null;
    try {
      pass = await api.post(`${at}/open`, {});
    } catch (err) {
      if (err.status !== 401) { setError(err.message); return; }
      const answer = await ask(stepUpAsk(data?.stepUpFactor, `open ${doc.filename}`));
      if (!answer) return;
      try { pass = await api.post(`${at}/open`, stepUpBody(data?.stepUpFactor, answer)); }
      catch (err2) { setError(err2.message); return; }
    }
    window.location.assign(`/api${at}?ticket=${encodeURIComponent(pass.ticket)}`);
  }

  async function removeDocument(essentialId, doc) {
    if (!window.confirm(`Delete ${doc.filename} permanently?`)) return;
    try {
      await api.del(`/essentials/${ownerId}/${essentialId}/documents/${doc.id}`);
      load();
    } catch (err) { setError(err.message); }
  }

  async function confirmStill(id) {
    setError('');
    try {
      await api.patch(`/essentials/${ownerId}/${id}`, { verified: true });
      setNotice('Marked as confirmed today.');
      load();
    } catch (err) { setError(err.message); }
  }

  async function remove(id) {
    if (!window.confirm('Delete this permanently?')) return;
    try { await api.del(`/essentials/${ownerId}/${id}`); load(); }
    catch (err) { setError(err.message); }
  }

  // The old passport, the visa for a trip already taken, the policy that
  // lapsed when the broker changed. Deleting them is wrong — a superseded
  // passport number is exactly what a form asks for when it wants travel
  // history — but two passport numbers side by side, one of them dead, is how
  // the wrong one gets read out at a check-in desk.
  async function archive(id) {
    setError('');
    try {
      await api.post(`/essentials/${ownerId}/${id}/archive`, {});
      setNotice('Put away. It has left this list and the renewal reminders, and is in the Archive.');
      load();
    } catch (err) { setError(err.message); }
  }

  async function copyTravelBlock() {
    setError('');
    let d = null;
    try {
      d = await api.post(`/essentials/${ownerId}/travel-block`, {});
    } catch (err) {
      if (err.status !== 401) { setError(err.message); return; }
      const answer = await ask(stepUpAsk(data?.stepUpFactor, 'assemble the travel details'));
      if (!answer) return;
      try {
        d = await api.post(`/essentials/${ownerId}/travel-block`, stepUpBody(data?.stepUpFactor, answer));
      } catch (err2) { setError(err2.message); return; }
    }
    await navigator.clipboard?.writeText(d.text);
    setNotice(`Copied ${d.lineCount} details — paste into the booking.`);
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/essentials/${ownerId}`, form);
      setForm({ category: form.category, field: '', value: '', expiresOn: '' });
      setAdding(false);
      load();
    } catch (err) { setError(err.message); }
  }

  const chosen = catalogue.find((c) => c.id === form.category);
  const chosenField = chosen?.fields.find((f) => f.id === form.field);

  if (!data) return <p className="hint">Loading…</p>;

  const groups = catalogue
    .map((c) => ({ ...c, items: data.essentials.filter((e) => e.category === c.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      {askDialog}
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {!data.encryptionConfigured && (
        <div className="alert alert-warning">
          <strong>Identity documents aren't available yet.</strong> Passports, visas, licences
          and national IDs need an encryption key, and this deployment has none — so rather than
          hold them in the clear, Kairos won't hold them at all. Everything else works normally:
          preferences, allergies, loyalty numbers, sizes, policy numbers.
          {' '}Setting a key takes a couple of minutes and needs no technical knowledge:{' '}
          <a href="/dashboard?tab=security">Security</a> will make one for you.
        </div>
      )}

      <div className="ess-actions">
        <button className="btn btn-primary btn-sm" type="button" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel' : 'Add a detail'}
        </button>
        {data.essentials.length > 0 && (
          <button className="btn btn-sm" type="button" onClick={copyTravelBlock}>
            Copy travel details
          </button>
        )}
      </div>

      {/* Said plainly rather than left to be discovered. Someone holding a
          passport expects to be able to photograph it, and finding out only
          after they have looked for the button is worse than being told. */}
      <p className="hint ess-uploads">
        Details only for now — uploading a scan or photograph of a document isn't available yet.
      </p>

      {adding && (
        <form className="card" onSubmit={submit}>
          <div className="field">
            <label htmlFor="ess-category">Kind</label>
            <select
              id="ess-category" value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value, field: '' })}
            >
              {/* Offering a category that will be refused on save is worse than
                  not offering it: the work is done by then, and a passport
                  number has been typed into a box that was never going to
                  keep it. */}
              {catalogue.map((c) => {
                // Locked only when EVERY field in it is sensitive. Identity
                // numbers mixes both — a TIN is printed on invoices and an RC
                // number is on the letterhead — and disabling the whole group
                // for want of a key would hide two fields that never needed one.
                const locked = !data.encryptionConfigured
                  && c.fields.every((f) => sensitivityOf(c, f) === 'sensitive');
                return (
                  <option key={c.id} value={c.id} disabled={locked}>
                    {c.label}{locked ? ' — not available yet' : ''}
                  </option>
                );
              })}
            </select>
            {chosen && <p className="hint">{chosen.hint}</p>}
          </div>
          <div className="field">
            <label htmlFor="ess-field">Detail</label>
            <select
              id="ess-field" value={form.field} required
              onChange={(e) => setForm({ ...form, field: e.target.value })}
            >
              <option value="">Choose…</option>
              {(chosen?.fields || []).map((f) => {
                const locked = sensitivityOf(chosen, f) === 'sensitive' && !data.encryptionConfigured;
                return (
                  <option key={f.id} value={f.id} disabled={locked}>
                    {f.label}{locked ? ' — not available yet' : ''}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ess-value">Value</label>
            <input
              id="ess-value" type="text" value={form.value} required
              onChange={(e) => setForm({ ...form, value: e.target.value })}
            />
            {chosen && chosenField && sensitivityOf(chosen, chosenField) === 'sensitive' && (
              <p className="hint">Stored encrypted. Hidden by default, and every reveal is logged.</p>
            )}
          </div>
          {chosenField?.expires && (
            <div className="field">
              <label htmlFor="ess-expires">Expires on</label>
              <input
                id="ess-expires" type="date" value={form.expiresOn}
                onChange={(e) => setForm({ ...form, expiresOn: e.target.value })}
              />
              <p className="hint">The reason this feature exists — you'll be reminded well before it lapses.</p>
            </div>
          )}
          <button className="btn btn-primary" type="submit">Save</button>
        </form>
      )}

      {groups.length === 0 && !adding && (
        <div className="empty-state">
          Nothing recorded yet. Start with the things you get asked for constantly — seat
          preference, frequent flyer number, dietary requirements.
        </div>
      )}

      {groups.map((group) => (
        <section className="ess-group" key={group.id}>
          <h3 className="ess-heading">{group.label}</h3>
          {group.items.map((e) => (
            <div
              className={'card ess-row' + (e.id === focusId ? ' is-focused' : '')}
              key={e.id}
              id={`essential-${e.id}`}
            >
              <div className="ess-main">
                <div className="ess-label">
                  {e.label}
                  {e.subjectName && <span className="hint"> · {e.subjectName}</span>}
                </div>
                <div className={'ess-value' + (e.masked ? ' is-masked' : '')}>
                  {revealed[e.id] ?? e.value}
                </div>
                <div className="ess-meta">
                  <ExpiryPill essential={e} />
                  <StalePill essential={e} />
                  {e.verifiedAt && (
                    <span className="hint">
                      Confirmed {new Date(e.verifiedAt).toLocaleDateString()}
                      {e.verifiedByName ? ` by ${e.verifiedByName}` : ''}
                    </span>
                  )}
                </div>
              </div>
              {/* What is attached, and what it would cost to open. Filenames
                  and sizes only — the bytes are behind the same gate as the
                  number above them. */}
              {(e.documents || []).length > 0 && (
                <ul className="ess-docs">
                  {e.documents.map((doc) => (
                    <li key={doc.id}>
                      <button className="btn btn-sm" type="button"
                        onClick={() => openDocument(e.id, doc)}>
                        Open {doc.filename}
                      </button>
                      <span className="hint">
                        {doc.formatLabel} · {Math.max(1, Math.round(doc.bytes / 1024))} KB
                        {doc.sensitivity === 'sensitive' ? ' · opening is recorded' : ''}
                      </span>
                      {/* Only when something other than the field decided it —
                          a badge on every document in a vault of sensitive
                          things says nothing at all. */}
                      {doc.flagNote && <span className="pill is-warn">Sensitive</span>}
                      <button className="btn btn-danger btn-sm" type="button"
                        onClick={() => removeDocument(e.id, doc)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="ess-buttons">
                {e.masked && !revealed[e.id] && (
                  <button className="btn btn-sm" type="button" onClick={() => reveal(e.id)}>Reveal</button>
                )}
                {/* A label rather than a button, because a file input cannot be
                    styled and a button cannot open a file picker. The input is
                    the control; this is its face. */}
                {data.documentsAvailable && (
                  <label className="btn btn-sm ess-attach">
                    Attach a document
                    <input
                      type="file"
                      accept={formats.map((f) => f.accept).join(',')}
                      onChange={(ev) => {
                        const file = ev.target.files?.[0];
                        // Cleared so choosing the same file twice still fires.
                        ev.target.value = '';
                        attach(e.id, file);
                      }}
                    />
                  </label>
                )}
                <button className="btn btn-sm" type="button" onClick={() => confirmStill(e.id)}>
                  Still correct
                </button>
                {/* Offered BEFORE Delete, deliberately. For a document that has
                    been superseded rather than mistaken, putting it away is
                    almost always what was meant, and a screen whose only exit
                    is Delete teaches people to delete. */}
                <button className="btn btn-sm" type="button" onClick={() => archive(e.id)}>
                  Archive
                </button>
                <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(e.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </section>
      ))}

      <div className="code-actions" style={{ marginTop: 12 }}>
        <SoonButton feature="document_scans" />
      </div>

      {data.archivedCount > 0 && (
        <p className="hint" style={{ marginTop: 16 }}>
          {data.archivedCount === 1
            ? '1 document is put away'
            : `${data.archivedCount} documents are put away`}
          {' '}— read them or bring them back in <a href="/archive">the Archive</a>.
        </p>
      )}

      {!data.canSeeSensitive && (
        <p className="hint" style={{ marginTop: 16 }}>
          Your remit here covers scheduling, so identity details are not shown.
        </p>
      )}

    </div>
  );
}
