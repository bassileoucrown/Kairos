import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

// Recording a voice note.
//
// This exists for one person in one situation: a principal in the back of a
// car who is not going to type. Everything here follows from that — one big
// button, an obvious timer, and a preview before anything is sent, because the
// alternative to a preview is a principal discovering they sent forty seconds
// of road noise to their Chief of Staff.
//
// Nothing leaves the browser until Send. The recording lives in memory as a
// Blob, and Discard drops it.

/** What the browser will actually produce. Chrome/Firefox: webm. Safari: mp4. */
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function clock(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The recording could not be read.'));
    // readAsDataURL gives "data:audio/webm;base64,AAAA…" — the payload is
    // everything after the comma.
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(blob);
  });
}

export default function VoiceRecorder({ threadId, maxSeconds = 120, retentionDays = 30, onSent }) {
  const [state, setState] = useState('idle');      // idle | recording | ready | sending
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState(null);          // { blob, url, mimeType, durationMs }
  const [error, setError] = useState('');

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedRef = useRef(0);
  const tickRef = useRef(null);
  const clipRef = useRef(null);

  // Object URLs and microphone tracks both outlive the component unless they
  // are let go explicitly — and a live microphone track is the one leak a user
  // can actually see, as their browser keeps showing the recording indicator.
  useEffect(() => () => {
    if (clipRef.current?.url) URL.revokeObjectURL(clipRef.current.url);
    if (tickRef.current) clearInterval(tickRef.current);
    recorderRef.current?.stream?.getTracks?.().forEach((t) => t.stop());
  }, []);

  function stopTracks() {
    recorderRef.current?.stream?.getTracks?.().forEach((t) => t.stop());
  }

  async function start() {
    setError('');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot record audio.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Every getUserMedia failure looks the same to the person: nothing
      // happened. Naming the likely cause is more use than naming the
      // exception.
      setError('Kairos needs permission to use your microphone.');
      return;
    }

    const mimeType = pickMimeType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = rec;
    chunksRef.current = [];

    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const type = rec.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      const next = {
        blob,
        url: URL.createObjectURL(blob),
        mimeType: type,
        durationMs: Date.now() - startedRef.current,
      };
      clipRef.current = next;
      setClip(next);
      setState('ready');
      stopTracks();
    };

    startedRef.current = Date.now();
    setElapsed(0);
    rec.start();
    setState('recording');

    tickRef.current = setInterval(() => {
      const ms = Date.now() - startedRef.current;
      setElapsed(ms);
      // Stops itself at the ceiling rather than letting someone talk for five
      // minutes and then telling them it was too long.
      if (ms >= maxSeconds * 1000) stop();
    }, 200);
  }

  function stop() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  function discard() {
    if (clipRef.current?.url) URL.revokeObjectURL(clipRef.current.url);
    clipRef.current = null;
    setClip(null);
    setElapsed(0);
    setState('idle');
    setError('');
  }

  async function send() {
    if (!clip) return;
    setError('');
    setState('sending');
    try {
      const audio = await blobToBase64(clip.blob);
      await api.post(`/threads/${threadId}/voice`, {
        audio,
        mimeType: clip.mimeType,
        durationMs: clip.durationMs,
      });
      discard();
      onSent?.();
    } catch (err) {
      setError(err.message);
      setState('ready');
    }
  }

  return (
    <div className="voice-recorder">
      {error && <div className="alert alert-error">{error}</div>}

      {state === 'idle' && (
        <button className="btn btn-secondary btn-sm voice-start" type="button" onClick={start}>
          🎤 Record a voice note
        </button>
      )}

      {state === 'recording' && (
        <div className="voice-live">
          <span className="voice-dot" aria-hidden="true" />
          <span className="voice-clock">{clock(elapsed)}</span>
          <span className="hint">of {clock(maxSeconds * 1000)}</span>
          <button className="btn btn-primary btn-sm" type="button" onClick={stop}>Stop</button>
        </div>
      )}

      {(state === 'ready' || state === 'sending') && clip && (
        <div className="voice-preview">
          <audio className="voice-audio" controls src={clip.url} />
          <div className="voice-preview-actions">
            <button className="btn btn-primary btn-sm" type="button" onClick={send} disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Send voice note'}
            </button>
            <button className="btn btn-sm" type="button" onClick={discard} disabled={state === 'sending'}>
              Discard
            </button>
          </div>
          <p className="hint voice-retention">
            Listen back before you send it. Recordings are kept encrypted and removed after{' '}
            {retentionDays} days.
          </p>
        </div>
      )}
    </div>
  );
}
