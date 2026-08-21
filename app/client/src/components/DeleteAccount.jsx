import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { setActivePrincipal } from './AppShell.jsx';
import PasswordField from './PasswordField.jsx';

// Closing an account.
//
// The only irreversible action in the product, so it is built to be hard to do
// by accident and impossible to do without knowing what goes: the counts are
// real, fetched for this account, rather than boilerplate warning copy. The
// password is required because a session left open on a desk should not be
// enough, and the panel stays collapsed until asked for.

function Line({ n, singular, plural }) {
  if (!n) return null;
  return <li>{n} {n === 1 ? singular : (plural || `${singular}s`)}</li>;
}

export default function DeleteAccount() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open || summary) return;
    api.get('/profile/account-summary')
      .then((d) => setSummary(d.summary))
      .catch((err) => setError(err.message));
  }, [open, summary]);

  async function handleDelete(e) {
    e.preventDefault();
    setError('');
    setWorking(true);
    try {
      await api.del('/profile/account', { password });
      setActivePrincipal(null);
      // The account is gone, so there is nothing left to refresh into —
      // clearing auth state first stops the app briefly rendering a signed-in
      // shell for a user the server no longer has.
      await refresh?.();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err.message);
      setWorking(false);
    }
  }

  if (!open) {
    return (
      <div className="danger-zone">
        <h3>Close this account</h3>
        <p className="hint">
          Permanently deletes your account and everything in it. There is no undo and no backup to
          restore from.
        </p>
        <button className="btn btn-danger btn-sm" type="button" onClick={() => setOpen(true)}>
          Close account…
        </button>
      </div>
    );
  }

  const s = summary;
  const nothing = s && !Object.values(s).some(Boolean);

  return (
    <div className="danger-zone is-open">
      <h3>Close this account</h3>
      {error && <div className="alert alert-error">{error}</div>}

      {!s && <p className="hint">Checking what this would remove…</p>}
      {s && (
        <>
          <p>Deleting this account permanently removes:</p>
          <ul className="danger-list">
            <Line n={s.bookings} singular="upcoming or past booking" />
            <Line n={s.itineraryItems} singular="itinerary item" />
            <Line n={s.contacts} singular="contact" />
            <Line n={s.meetingTypes} singular="meeting type" />
            <Line n={s.spaces} singular="space" plural="spaces" />
            <Line n={s.messages} singular="message you wrote" plural="messages you wrote" />
            <Line n={s.unfinishedForOthers} singular="unfinished draft for someone else" plural="unfinished drafts for other people" />
            {nothing && <li>Nothing yet — this account is empty.</li>}
          </ul>

          {s.handedBackToPrincipals > 0 && (
            <p className="hint">
              {s.handedBackToPrincipals} confirmed {s.handedBackToPrincipals === 1 ? 'item' : 'items'} you
              put on other people's calendars will stay on theirs — closing your account doesn't empty
              their diary.
            </p>
          )}

          {(s.assistantsWhoLoseAccess > 0 || s.principalsYouWouldStopSupporting > 0) && (
            <div className="alert alert-warning">
              {s.assistantsWhoLoseAccess > 0 && (
                <div>
                  {s.assistantsWhoLoseAccess} {s.assistantsWhoLoseAccess === 1 ? 'person' : 'people'} currently
                  {' '}{s.assistantsWhoLoseAccess === 1 ? 'works' : 'work'} on this account and will lose
                  access immediately.
                </div>
              )}
              {s.principalsYouWouldStopSupporting > 0 && (
                <div>
                  You currently support {s.principalsYouWouldStopSupporting}
                  {' '}{s.principalsYouWouldStopSupporting === 1 ? 'person' : 'people'}. They lose your help
                  immediately, and your unfinished drafts for them go with the account.
                </div>
              )}
            </div>
          )}
        </>
      )}

      <form onSubmit={handleDelete}>
        <PasswordField
          id="delete-password"
          label="Enter your password to confirm"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        <div className="danger-actions">
          <button className="btn btn-danger" type="submit" disabled={working || !password}>
            {working ? 'Deleting…' : 'Delete my account permanently'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => { setOpen(false); setPassword(''); setError(''); }}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
