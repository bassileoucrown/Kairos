import { useEffect, useState } from 'react';
import { canPrompt, isInstalled, isIos, onInstallability, promptInstall } from '../lib/pwa.js';
import { BRAND_SHORT } from '../lib/brand.js';

/**
 * Putting Kairos on the home screen.
 *
 * IN SETTINGS, NOT AS A BANNER. A bar across the top of the day sheet saying
 * "install our app" is the single most ignored object on the mobile web, and
 * it would sit on top of the one screen this product exists to keep clear. The
 * offer lives where somebody goes when they are setting the thing up, and it
 * is simply absent once there is nothing to offer.
 *
 * THREE STATES, because the platforms genuinely differ:
 *
 *   Installed — say so and stop. Nothing to do, and an install button in an
 *     installed app is a small insult.
 *   Chrome and the rest — the browser hands the page an event it can fire
 *     later. One button, at a moment the reader chose.
 *   iOS — Safari offers no such event and never has, so the only honest thing
 *     is to describe the two taps. Guessing which browser somebody is in and
 *     hoping is how people end up staring at a Share sheet they were not
 *     expecting.
 */
export default function InstallApp() {
  const [installed, setInstalled] = useState(isInstalled);
  const [available, setAvailable] = useState(canPrompt);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onInstallability(() => setAvailable(canPrompt())), []);
  useEffect(() => {
    const onInstalledEvent = () => setInstalled(true);
    window.addEventListener('appinstalled', onInstalledEvent);
    return () => window.removeEventListener('appinstalled', onInstalledEvent);
  }, []);

  async function install() {
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === 'dismissed') setDismissed(true);
    } finally { setBusy(false); }
  }

  if (installed) {
    return (
      <div className="card">
        <div className="name">On this device</div>
        <p className="hint" style={{ marginTop: 6 }}>
          {BRAND_SHORT} is installed here and opens from the home screen.
        </p>
      </div>
    );
  }

  const ios = isIos();
  // Nothing to say: not iOS, and the browser has not offered. Either it is a
  // desktop that will not install, or it has already been installed and
  // removed. An empty card explaining that would be worse than no card.
  if (!ios && !available) return null;

  return (
    <div className="card">
      <div className="name">Put {BRAND_SHORT} on your home screen</div>
      <p className="hint" style={{ marginTop: 6 }}>
        It opens straight onto your day, without the address bar, and behaves
        like any other app on the phone.
      </p>

      {ios ? (
        // Written as the two taps rather than as a paragraph about them.
        <ol className="install-steps">
          <li>Tap the Share button at the bottom of Safari.</li>
          <li>Choose <strong>Add to Home Screen</strong>.</li>
        </ol>
      ) : (
        <>
          <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={install}>
            {busy ? 'Installing…' : 'Install'}
          </button>
          {dismissed && (
            <p className="hint" style={{ marginTop: 8 }}>
              No trouble — it is here whenever you want it.
            </p>
          )}
        </>
      )}
    </div>
  );
}
