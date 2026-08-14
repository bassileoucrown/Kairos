import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

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

export default function EssentialsTab({ ownerId }) {
  const [data, setData] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revealed, setRevealed] = useState({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ category: 'preferences', field: '', value: '', expiresOn: '' });

  function load() {
    return api.get(`/essentials/${ownerId}`).then(setData).catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (!ownerId) return;
    load();
    api.get('/essentials/catalogue').then((d) => setCatalogue(d.categories)).catch(() => {});
  }, [ownerId]);

  async function reveal(id) {
    const password = window.prompt('Enter your password to reveal this. The principal can see that you did.');
    if (!password) return;
    setError('');
    try {
      const d = await api.post(`/essentials/${ownerId}/${id}/reveal`, { password });
      setRevealed((r) => ({ ...r, [id]: d.essential.value }));
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

  async function copyTravelBlock() {
    const password = window.prompt('Enter your password to assemble the travel details.');
    if (!password) return;
    setError('');
    try {
      const d = await api.post(`/essentials/${ownerId}/travel-block`, { password });
      await navigator.clipboard?.writeText(d.text);
      setNotice(`Copied ${d.lineCount} details — paste into the booking.`);
    } catch (err) { setError(err.message); }
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
            <div className="card ess-row" key={e.id}>
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
              <div className="ess-buttons">
                {e.masked && !revealed[e.id] && (
                  <button className="btn btn-sm" type="button" onClick={() => reveal(e.id)}>Reveal</button>
                )}
                <button className="btn btn-sm" type="button" onClick={() => confirmStill(e.id)}>
                  Still correct
                </button>
                <button className="btn btn-danger btn-sm" type="button" onClick={() => remove(e.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </section>
      ))}

      {!data.canSeeSensitive && (
        <p className="hint" style={{ marginTop: 16 }}>
          Your remit here covers scheduling, so identity details are not shown.
        </p>
      )}
    </div>
  );
}
