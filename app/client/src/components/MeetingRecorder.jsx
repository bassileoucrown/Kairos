import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// Recording what was said in the room.
//
// THE NOTICE IS A STEP, NOT A LINE OF SMALL PRINT. Nothing starts until
// somebody has read the sentence and pressed again. That is one extra click on
// the least frequent action in the product, and it is the difference between a
// consent notice and a claim that one was shown.
//
// THERE IS NO AUTOMATIC START, here or on the server. A recording that begins
// because a meeting began is the version of this feature that gets an office
// sued, and a principal whose counterparties learn their meetings are taped by
// default has lost more than the feature is worth.
//
// WHEN THE DEPLOYMENT CANNOT RECORD IT SAYS WHICH CREDENTIAL IS MISSING rather
// than hiding the control. An operator reading "not configured" learns
// nothing; one reading STORAGE_SECRET has been handed a task.

const CHUNK_MS = 1000;

export default function MeetingRecorder({ ownerId, bookingId, state, onChanged }) {
  const [ready, setReady] = useState(null);
  const [captured, setCaptured] = useState([]);
  const [notice, setNotice] = useState('');
  const [asking, setAsking] = useState(false);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recorder = useRef(null);
  const chunks = useRef([]);

  const base = ownerId
    ? `/pa/${ownerId}/bookings/${bookingId}`
    : `/bookings/${bookingId}`;

  async function load() {
    try {
      const d = await api.get(`${base}/recordings`);
      setReady(d.readiness);
      setCaptured(d.recordings || []);
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, [bookingId]);

  // Stop the tracks on the way out. A microphone left open because somebody
  // navigated away is the kind of bug people notice by the light on the laptop.
  useEffect(() => () => {
    try { recorder.current?.stream?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
  }, []);

  async function setState(next) {
    setBusy(true); setError('');
    try {
      const d = await api.post(`${base}/recording`, { state: next });
      setNotice(d.notice || '');
      onChanged?.();
      return true;
    } catch (err) { setError(err.message); return false; } finally { setBusy(false); }
  }

  async function start() {
    setError('');
    // The server is told FIRST. If it refuses — no consent state, no
    // credentials — the microphone is never opened at all, which is the right
    // order: asking for a microphone and then discovering you cannot use it
    // has already asked somebody for something.
    if (!(await setState('on'))) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.current.push(e.data); };
      rec.start(CHUNK_MS);
      recorder.current = rec;
      setLive(true);
      setAsking(false);
    } catch (err) {
      // The state goes back, so a meeting is never left marked as recording
      // when nothing is.
      await setState('off');
      setError(`The microphone could not be opened: ${err.message}`);
    }
  }

  async function stop() {
    const rec = recorder.current;
    if (!rec) return;
    setBusy(true);
    const blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }));
      rec.stop();
    });
    try { rec.stream.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
    recorder.current = null;
    setLive(false);

    try {
      const buf = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      await api.post(`${base}/recording/audio`, {
        audio: btoa(binary),
        mimeType: (rec.mimeType || 'audio/webm').split(';')[0],
        durationMs: 0,
      });
      await setState('stopped');
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (!ready) return null;

  if (!ready.available) {
    return (
      <div className="minute-record">
        <p className="hint">
          Recording is not available on this deployment. It is waiting on{' '}
          {ready.missing.map((m, i) => (
            <span key={m}>{i > 0 ? ', ' : ''}<code>{m}</code></span>
          ))}.
        </p>
      </div>
    );
  }

  return (
    <div className="minute-record">
      {error && <div className="alert alert-error">{error}</div>}

      {captured.length > 0 && (
        <p className="hint">
          {captured.length} recording{captured.length === 1 ? '' : 's'} on this meeting
          {' · '}the words are filed with the notes below
          {/* Said out loud, because the two have different lifetimes and a
              principal should not discover that by looking for the audio. */}
          {captured[0].expiresAt && ` · audio is deleted after ${String(captured[0].expiresAt).slice(0, 10)}`}
        </p>
      )}

      {live ? (
        <>
          <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={stop}>
            {busy ? 'Filing the recording…' : 'Stop recording'}
          </button>
          <span className="hint"> Recording. Everyone in the room has been told.</span>
        </>
      ) : asking ? (
        <div className="alert alert-warning">
          <strong>Before you start.</strong> {notice
            || 'Everyone in this meeting must be told it is being recorded, before it starts. '
              + 'Kairos shows that this meeting was recorded, and by whom, on the meeting itself.'}
          <div className="movement-inline" style={{ marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={start}>
              They have been told — start
            </button>
            <button className="btn btn-sm" type="button" onClick={() => setAsking(false)}>
              Not now
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-sm" type="button" onClick={() => setAsking(true)}>
          Record this meeting
        </button>
      )}
    </div>
  );
}
