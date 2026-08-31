import { useState } from 'react';
import { api } from '../lib/api.js';
import SoonButton, { useCapability } from './SoonButton.jsx';

// One control for all seven of the things AI Assist can do.
//
// WHY ONE COMPONENT AND NOT SEVEN. They differ only in which endpoint they
// call and what they do with the answer. Written seven times, the part that
// would drift is the part that matters least to write and most to get right:
// the refusal. An office with no model configured must be told the same thing
// in the same words wherever they press, and the only reliable way to do that
// is for there to be one place that says it.
//
// IT VANISHES INTO SoonButton WITHOUT A KEY. Not greyed out, not hidden — the
// named control stands in the place the working one will occupy, and pressing
// it explains what it is waiting on. That is the pattern every other
// unconfigured capability in this product already uses; see SoonButton.jsx.
//
// AND WHAT COMES BACK IS NEVER APPLIED HERE. The caller is handed the answer
// and decides. Nothing in this component writes anything, for the same reason
// nothing in lib/assist.js does.
export default function AssistButton({
  feature,          // capability id, so the screen says the right thing without one
  path,             // where to ask
  body,             // what to ask with
  label,            // the word on the button when it works
  onResult,         // what the screen does with the answer
  className = 'btn btn-sm',
}) {
  const cap = useCapability(feature);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Nothing until we know; the placeholder while it is unavailable.
  if (!cap) return null;
  if (!cap.available) return <SoonButton feature={feature} label={label} />;

  async function run() {
    setBusy(true);
    setError('');
    try {
      onResult(await api.post(path, body));
    } catch (err) {
      // The server distinguishes no-model from the-vault from it-failed, and
      // each wants different words. Passing the message through keeps all
      // three rather than flattening them into "something went wrong".
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <span className="assist-control">
      <button className={className} type="button" onClick={run} disabled={busy}>
        {busy ? 'Thinking…' : (label || cap.control)}
      </button>
      {/* Shown here rather than swallowed. A button that silently does nothing
          teaches somebody the feature is broken and never says why. */}
      {error && <span className="alert alert-error assist-error">{error}</span>}
    </span>
  );
}
