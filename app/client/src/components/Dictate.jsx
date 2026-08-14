import { useEffect, useRef, useState } from 'react';
import { listenOnce, speechAvailable, recognitionIsLocal } from '../lib/speech.js';

// A microphone beside a box, and the sentence it heard put in the box.
//
// Nothing here interprets anything. Dictation fills the same field the fingers
// would, and the existing parser reads it exactly as before — which is why
// speaking to the assistant needed no new understanding on the server, and why
// what it can and cannot do is unchanged by having been spoken.
//
// The text is appended rather than replacing what is there, so a second
// sentence adds to the first and a correction typed by hand is not wiped out
// by pressing the button again.

export default function Dictate({ onText, label = 'Speak' }) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const stop = useRef(null);

  // A recogniser left running after the screen is gone keeps the microphone
  // light on, which is the single most alarming thing an app can do.
  useEffect(() => () => stop.current?.(), []);

  if (!speechAvailable()) return null;

  function toggle() {
    if (listening) { stop.current?.(); return; }
    setError('');
    setHeard('');
    setListening(true);
    stop.current = listenOnce({
      onInterim: setHeard,
      onFinal: (text) => onText(text),
      onError: (msg) => { if (msg) setError(msg); },
      onEnd: () => { setListening(false); setHeard(''); },
    });
  }

  return (
    <div className="dictate">
      <button
        type="button"
        className={`btn btn-sm dictate-btn${listening ? ' is-live' : ''}`}
        onClick={toggle}
        aria-pressed={listening}
      >
        <span aria-hidden="true">{listening ? '■' : '🎤'}</span>
        {listening ? 'Stop' : label}
      </button>

      {/* A microphone that looks the same while listening and while broken is
          one people press twice and then stop trusting. */}
      {listening && (
        <span className="dictate-heard">{heard || 'Listening…'}</span>
      )}

      {error && <span className="dictate-error">{error}</span>}

      {!listening && !recognitionIsLocal() && (
        <span className="dictate-note">
          Your browser sends what you say to its own servers to turn it into
          text. Type it instead if the wording is sensitive.
        </span>
      )}
    </div>
  );
}
