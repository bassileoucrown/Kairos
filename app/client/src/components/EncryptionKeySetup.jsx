import { useState } from 'react';

// Generating the encryption key, for somebody who is not sitting at a terminal.
//
// The documented way to produce this key was a command line — which assumes a
// developer, and the person setting up a deployment is very often not one. That
// left the single most important security setting behind a tool they do not
// have, so it stayed unset, which is the worst outcome of all.
//
// So the app makes the key itself, in the browser, using the same cryptographic
// generator a password manager uses. It is never sent to Kairos and never
// written down anywhere by us: the value exists in this tab and nowhere else
// until the person pastes it into their host. That is the point — a key the
// server has seen is a key the server could keep.

/** 32 random bytes as 64 hex characters, from the browser's own CSPRNG. */
function generateKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function EncryptionKeySetup() {
  const [key, setKey] = useState('');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access is refused in plenty of ordinary situations. The key
      // is on screen and selectable, so this is a convenience failing, not the
      // task failing — saying so beats a dead button.
      setCopied(false);
    }
  }

  return (
    <section className="ess-group key-setup">
      <h3 className="ess-heading">Encryption key</h3>

      <div className="card">
        <p>
          <span className="pill is-off">Not set</span>{' '}
          Until this deployment has an encryption key, three things stay switched off.
        </p>
        <ul className="key-unlocks">
          <li>Identity details — passport, visa, insurance numbers</li>
          <li>Two-factor authentication</li>
          <li>Voice notes on the direct line</li>
        </ul>
        <p className="hint">
          Everything else works normally. Preferences, allergies, loyalty numbers and sizes are
          not secrets and are stored as they are.
        </p>

        {!key && (
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setKey(generateKey())}>
            Generate a key
          </button>
        )}

        {key && (
          <>
            <div className="key-value">
              <code>{key}</code>
            </div>
            <div className="code-actions">
              <button className="btn btn-primary btn-sm" type="button" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button className="btn btn-sm" type="button" onClick={() => setKey(generateKey())}>
                Generate a different one
              </button>
            </div>

            <div className="alert alert-warning key-warning">
              <strong>Save this somewhere safe before you do anything else.</strong> A password
              manager, or wherever your company keeps things it cannot replace. It is not stored
              here and cannot be recovered — if it is lost, every identity detail and every
              recording saved under it is gone permanently. Do not email it, paste it into a chat,
              or send it to anyone, including us.
            </div>

            <ol className="key-steps">
              <li>Copy the key above and save it.</li>
              <li>Open your Render dashboard and click your Kairos service.</li>
              <li>Click <strong>Environment</strong> in the left-hand menu.</li>
              <li>Click <strong>Add Environment Variable</strong>.</li>
              <li>
                For the name type <code>ENCRYPTION_KEY</code>, and for the value paste the key.
              </li>
              <li>Click <strong>Save changes</strong>. Render restarts the app by itself.</li>
              <li>Wait for the deploy to finish, then reload this page.</li>
            </ol>

            <p className="hint">
              This key was made in your browser and has not been sent to Kairos. Closing this page
              forgets it — which is safe to do before you have saved anything under it, and not
              after.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
