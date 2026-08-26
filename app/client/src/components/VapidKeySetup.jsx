import { useState } from 'react';

/**
 * The push keys, made for somebody who is not sitting at a terminal.
 *
 * The same reasoning as the encryption key beside it. The documented way to
 * produce VAPID keys is `npx web-push generate-vapid-keys`, which assumes both
 * a developer and a machine with npm on it — and the person standing up a
 * deployment is often neither. So the app makes them, in the browser, with the
 * generator the platform already ships.
 *
 * WHAT VAPID ACTUALLY IS. A push notification does not travel from Kairos to a
 * phone. It goes to whichever push service the browser belongs to — Google's
 * for Chrome, Apple's for Safari — and that service will only carry a message
 * from a sender it can identify. VAPID is that identity: one keypair for the
 * whole deployment, used to sign every push. Not per user, not per device.
 *
 *   The public half is meant to be seen. It is handed to every browser that
 *   subscribes, and is what ties a subscription to this sender.
 *
 *   The private half signs. It never leaves the server, and it is the only
 *   thing stopping somebody else pushing notifications that appear to come
 *   from Kairos.
 *
 * KEEP THEM. This is the part worth reading twice: a subscription is bound to
 * the public key it was made with. Change the pair and every phone that has
 * ever subscribed is orphaned — silently, with no error anywhere — until each
 * person re-grants permission. There is no migration. Generate once, store
 * them where they cannot be lost, and treat them as permanent.
 *
 * Neither half is ever sent to Kairos from here. They exist in this tab and
 * nowhere else until they are pasted into the host, which is the point: a
 * private key the server has seen is a private key the server could keep.
 */

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = (s) => Uint8Array.from(
  atob(s.replace(/-/g, '+').replace(/_/g, '/')),
  (c) => c.charCodeAt(0),
);

/**
 * An ECDSA P-256 pair, in the shape the Web Push standard asks for.
 *
 * The public key is the uncompressed EC point — a 0x04 marker then X then Y,
 * 65 bytes — rather than any of the wrappers a keypair usually comes in. The
 * private key is the bare 32-byte scalar. Both base64url, which is why they
 * come out 87 and 43 characters and never anything else.
 */
async function generatePair() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const x = fromB64url(jwk.x);
  const y = fromB64url(jwk.y);
  const point = new Uint8Array(65);
  point[0] = 4;
  point.set(x, 1);
  point.set(y, 33);
  return {
    // jwk.d is already base64url — the standard's encoding and the JWK's
    // happen to agree, so re-encoding it would only be a chance to get it
    // wrong.
    publicKey: b64url(point),
    privateKey: jwk.d,
  };
}

function KeyLine({ label, value, hint }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Refused in plenty of ordinary situations. The value is on screen and
      // selectable, so this is a convenience failing, not the task failing.
      setCopied(false);
    }
  }
  return (
    <div className="field">
      <label>{label}</label>
      <code className="key-value">{value}</code>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <button className="btn btn-secondary btn-sm" type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        {hint && <span className="hint" style={{ margin: 0 }}>{hint}</span>}
      </div>
    </div>
  );
}

export default function VapidKeySetup() {
  const [keys, setKeys] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function make() {
    setBusy(true);
    setError('');
    try {
      setKeys(await generatePair());
    } catch (e) {
      // Almost always one cause. crypto.subtle exists only in a SECURE
      // CONTEXT — https, or localhost — so on a plain-http deployment it is
      // not merely restricted, it is undefined. Naming the browser would send
      // somebody to install a different one and hit exactly the same wall.
      setError(window.isSecureContext
        ? `The browser would not generate the pair (${e.message}).`
        : 'This page is not served over HTTPS, so the browser will not do cryptography on it. '
          + 'Open Kairos on its https:// address and try again.');
    } finally { setBusy(false); }
  }

  return (
    <section className="ess-group setup-card push-setup">
      <h3 className="ess-heading">Push notification keys</h3>

      <div className="card">
        <p>
          <span className="pill is-off">Not set</span>{' '}
          Without these, Kairos can show you what has arrived while you have it open,
          but cannot reach a phone that is in a pocket.
        </p>
        <p className="hint">
          One pair for the whole deployment — not one per person. They identify Kairos
          to Google's and Apple's push services, which will not carry a message from a
          sender they cannot identify.
        </p>

        {!keys && (
          <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={make}>
            {busy ? 'Generating…' : 'Generate a pair'}
          </button>
        )}
        {error && <div className="alert alert-error">{error}</div>}

        {keys && (
          <>
            <KeyLine
              label="VAPID_PUBLIC_KEY"
              value={keys.publicKey}
              hint="Handed to every browser. Not a secret."
            />
            <KeyLine
              label="VAPID_PRIVATE_KEY"
              value={keys.privateKey}
              hint="Server only. Treat it like a password."
            />

            {/* The warning that costs the most to learn the hard way. */}
            <div className="alert alert-error" style={{ marginTop: 12 }}>
              <strong>Save both before you leave this page.</strong> They are not stored
              anywhere — not by Kairos, not in this browser. And once people have started
              receiving notifications, replacing this pair silently orphans every phone
              that subscribed: no error appears, notifications simply stop, and each
              person has to grant permission again. Generate once and keep them.
            </div>

            {/* NOT NAMED AFTER ONE HOST. This used to begin "open your Render
                dashboard", which was both wrong for anyone hosting Kairos
                elsewhere and misleading about where the feature lives: the
                notifications themselves are Kairos's, built into it, and are
                turned on for a person under Settings. All that belongs to the
                host is the same thing that belongs to it for the database
                password — somewhere to keep a secret out of the code. */}
            <p className="hint" style={{ marginTop: 12 }}>
              These are environment variables, set wherever Kairos runs — the same place
              its database URL and encryption key are set. On Render that is the service's
              Environment tab; elsewhere it is whatever your host calls the same thing.
            </p>
            <ol className="install-steps">
              <li>Add <code>VAPID_PUBLIC_KEY</code> and <code>VAPID_PRIVATE_KEY</code> with the values above.</li>
              <li>
                Add <code>VAPID_SUBJECT</code> — an address the push services can complain
                to, written as <code>mailto:you@yourdomain.com</code>.
              </li>
              <li>Restart Kairos. The database is untouched, and this card disappears.</li>
              <li>
                Then, under <strong>Settings</strong>, turn alerts on for each device that
                should ring. That part is per person, not per deployment.
              </li>
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
