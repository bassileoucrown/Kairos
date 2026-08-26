import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { currentSubscription, disablePush, enablePush, pushState } from '../lib/push.js';
import { isInstalled, isIos } from '../lib/pwa.js';
import { BRAND_SHORT } from '../lib/brand.js';

/**
 * Being told when something arrives, on a phone that is in a pocket.
 *
 * BEHIND A BUTTON, ALWAYS. A permission prompt fired at somebody on arrival is
 * denied, and a denial is close to permanent — the browser stops asking, and the
 * way back is a settings screen most people never find. So the prompt happens
 * only when somebody has come to a screen about notifications and pressed the
 * thing that says notifications.
 *
 * PER DEVICE, AND SAID SO. Granting on a laptop does nothing for a phone, and
 * "you have already turned this on" shown on a phone that will never ring is
 * the most confusing thing this card could do. So the switch reflects THIS
 * browser, and the list underneath says how many devices are subscribed.
 *
 * THE STATE IS THE BROWSER'S, NOT OURS. There is no notifications flag in the
 * database; see lib/push.js. This card asks the browser every time it renders,
 * so somebody who revokes permission in their browser settings finds this card
 * agreeing with them rather than insisting.
 */
export default function PushSetup() {
  const [state, setState] = useState(() => pushState());
  const [subscribed, setSubscribed] = useState(null);
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');

  const refresh = useCallback(async () => {
    setState(pushState());
    try {
      setSubscribed(!!await currentSubscription());
    } catch { setSubscribed(false); }
    try {
      setConfig(await api.get('/push/config'));
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function turnOn() {
    setBusy(true); setError(''); setSaid('');
    try {
      const result = await enablePush();
      if (!result.ok) {
        setError({
          unsupported: 'This browser cannot receive notifications.',
          unconfigured: result.problem
            || `${BRAND_SHORT} has no push keys set on this deployment yet, so it cannot reach a phone.`,
          denied: 'Your browser is set to refuse notifications from this site. '
            + 'It has to be changed in the browser\'s own settings for this address — '
            + 'nothing on this page can undo it.',
          default: 'The prompt was dismissed. Press it again when you are ready.',
        }[result.reason] || 'That did not work.');
      } else {
        setSaid('This device will be told when something arrives.');
      }
    } catch (e) { setError(e.message); } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function turnOff() {
    setBusy(true); setError(''); setSaid('');
    try {
      await disablePush();
      setSaid('This device will stay quiet.');
    } catch (e) { setError(e.message); } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function ring() {
    setBusy(true); setError(''); setSaid('');
    try {
      setSaid((await api.post('/push/test')).message);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (state === 'unsupported') return null;

  const on = state === 'granted' && subscribed;
  // iOS grants nothing to a page in a tab: notifications there require the app
  // to have been added to the home screen first. Offering the button anyway
  // produces a silent failure that looks like a bug in Kairos.
  const iosNeedsInstall = isIos() && !isInstalled();

  return (
    <div className="card">
      <div className="name">
        Alerts on this device{' '}
        {on
          ? <span className="pill">On</span>
          : <span className="pill is-off">Off</span>}
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        A message on the direct line, a note handed to you, being named in a room —
        {BRAND_SHORT} can buzz for those even when it is closed. The alert says who and
        where; the words stay inside {BRAND_SHORT}.
      </p>

      {error && <div className="alert alert-error">{error}</div>}
      {said && <div className="alert alert-success">{said}</div>}

      {iosNeedsInstall ? (
        <p className="hint">
          On iPhone and iPad, notifications only work once {BRAND_SHORT} has been added to
          the home screen. Add it first — the card above says how — then come back here.
        </p>
      ) : config && !config.configured ? (
        <p className="hint">
          {config.problem
            || `This deployment has no push keys set, so ${BRAND_SHORT} cannot reach a phone yet. `
              + 'They are generated under Security.'}
        </p>
      ) : on ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Push is the one feature here whose failure is completely silent:
              nothing arriving looks exactly like nothing happening. */}
          <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={ring}>
            {busy ? 'Sending…' : 'Send a test alert'}
          </button>
          <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={turnOff}>
            Turn off here
          </button>
        </div>
      ) : (
        <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={turnOn}>
          {busy ? 'Asking…' : 'Turn on alerts'}
        </button>
      )}

      {config?.devices?.length > 0 && (
        <p className="hint" style={{ marginTop: 10 }}>
          {config.devices.length === 1
            ? 'One device on this account is set to receive alerts.'
            : `${config.devices.length} devices on this account are set to receive alerts.`}
        </p>
      )}
    </div>
  );
}
