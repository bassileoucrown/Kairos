import { useEffect, useState } from 'react';

// Setting up two-factor, for someone who has never used an authenticator.
//
// The old screen printed a 32-character base32 secret under the words "most
// apps scan a QR code" — and then rendered no QR code, named no app, and left
// the reader to work out that the six digits come from a program they have not
// installed. The server had been sending an otpauth:// URI the whole time and
// nothing used it.
//
// So this says the quiet part: you need an app, here are its names, here is the
// code to scan, here is the key to type if scanning fails, and here is why the
// number keeps changing.

/** Groups of four, because this gets typed by hand on a phone. */
function readable(secret) {
  return String(secret || '').replace(/(.{4})/g, '$1 ').trim();
}

const APPS = [
  'Google Authenticator',
  'Microsoft Authenticator',
  '1Password',
  'Authy',
];

export default function TwoFactorSetup({ setup, code, onCode, onSubmit, onCancel, error }) {
  const [qr, setQr] = useState('');
  const [qrFailed, setQrFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Loaded only when this screen opens. A QR encoder is dead weight in the
  // bundle for the overwhelming majority of page loads, which never come here.
  useEffect(() => {
    let live = true;
    if (!setup?.uri) return undefined;
    import('qrcode')
      .then((QR) => QR.toString(setup.uri, {
        type: 'svg', margin: 1, width: 200, errorCorrectionLevel: 'M',
      }))
      .then((svg) => { if (live) setQr(svg); })
      // The key is printed below and works identically typed in, so a failed
      // encoder costs convenience, not the feature.
      .catch(() => { if (live) setQrFailed(true); });
    return () => { live = false; };
  }, [setup?.uri]);

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { setCopied(false); }
  }

  return (
    <form className="card totp-setup" onSubmit={onSubmit}>
      <ol className="totp-steps">
        <li>
          <strong>Install an authenticator app on your phone</strong>, if you don't have one.
          <span className="hint totp-apps">
            {APPS.join(' · ')} — any of them works. They are free, and they generate the codes
            offline. Kairos never sends you a code by text or email.
          </span>
        </li>

        <li>
          <strong>Add this account to it.</strong>
          <div className="totp-add">
            {qr && (
              // The SVG comes from the QR encoder running in this browser over
              // a URI this page already holds — no third party sees the secret.
              <div className="totp-qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: qr }} />
            )}
            <div className="totp-manual">
              {!qr && !qrFailed && <p className="hint">Preparing the QR code…</p>}
              <p className="hint">
                {qr
                  ? 'In the app, choose “Scan a QR code” and point the camera at this.'
                  : 'Add the account by hand using the key below.'}
              </p>
              <p className="hint">
                Or choose “Enter a setup key” and type this:
              </p>
              <div className="totp-secret"><code>{readable(setup.secret)}</code></div>
              <div className="code-actions">
                <button className="btn btn-sm" type="button" onClick={copySecret}>
                  {copied ? 'Copied' : 'Copy key'}
                </button>
                {/* On a phone this opens the authenticator directly and fills
                    everything in. On a desktop nothing handles it, so it is not
                    the primary path. */}
                <a className="btn btn-sm totp-open" href={setup.uri}>
                  Open in my authenticator
                </a>
              </div>
            </div>
          </div>
        </li>

        <li>
          <strong>Type the six digits it shows.</strong>
          <span className="hint">
            The number changes every 30 seconds — enter the one on screen now, not one you
            noted earlier.
          </span>
          <div className="field totp-code-field">
            <label htmlFor="totp-code">Code from the app</label>
            <input
              id="totp-code" type="text" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} placeholder="000000"
              value={code} onChange={(e) => onCode(e.target.value)} required
            />
          </div>
        </li>
      </ol>

      {/* Beside the field it belongs to. At the top of the tab it sits above
          the fold of somebody's attention, next to whatever other banner the
          dashboard is already showing, and a rejected code reads as nothing
          happening. */}
      {error && <div className="alert alert-error totp-error">{error}</div>}

      <div className="code-actions">
        <button className="btn btn-primary" type="submit">Confirm</button>
        <button className="btn btn-sm" type="button" onClick={onCancel}>Cancel</button>
      </div>

      <p className="hint">
        If the code keeps being refused, check your phone's clock is set automatically. These
        codes are made from the time, so a phone running a few minutes out produces numbers that
        look right and never match.
      </p>
    </form>
  );
}
