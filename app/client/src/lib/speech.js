// Speaking to the assistant instead of typing to it.
//
// The scheduling assistant already takes a sentence — "book a call with Jane
// next Tuesday afternoon" — and turns it into real open slots. Typing that
// sentence is the slowest part of a job usually done standing up, between two
// other things, on a phone. Saying it is the natural input for this feature,
// and it needs no new parser: dictation fills the same box the fingers would.
//
// WHERE THE AUDIO GOES, which is the part that matters here.
//
// This uses the browser's own speech recognition. In Chrome and Edge that is
// not on-device: the audio is sent to the browser vendor's servers, returned
// as text, and Kairos never sees the recording. Safari on recent iOS and macOS
// recognises on-device by default. Firefox does not implement it at all.
//
// For most products that distinction is a footnote. For this one it is the
// whole question, because the sentence being dictated names a principal, a
// counterparty and a time. So:
//
//   - It is never on by default. Nothing listens until the microphone is
//     pressed, and it stops on its own at the end of the sentence.
//   - The screen says plainly, before it is used, that the words leave the
//     device to be turned into text — in the browsers where that is true.
//   - It is offered on the assistant's instruction box and nowhere else. The
//     direct line already takes voice, encrypted at rest with a key this
//     server holds and nobody else does (lib/voiceNotes.js); routing that
//     through a third party for a transcript would quietly undo the property
//     that made it worth building.
//
// A private path exists later — transcription on our own server behind a
// provider key, or a small on-device model — and this is deliberately written
// so the component calling it does not care which is underneath.

export function speechEngine() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function speechAvailable() {
  return !!speechEngine();
}

/**
 * Whether the recognised audio leaves the device.
 *
 * There is no API that answers this, so it is inferred: WebKit recognises
 * on-device on current Apple platforms, and the Chromium implementations send
 * audio to the vendor. Inference means it can be wrong in one direction, so it
 * defaults to the cautious answer — a warning shown to somebody who did not
 * need it costs a sentence; a warning withheld from somebody who did costs
 * more than that.
 */
export function recognitionIsLocal() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const webkit = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
  return webkit;
}

/**
 * One utterance, start to finish.
 *
 * `onInterim` receives the running guess so the screen can show that something
 * is being heard — a microphone that looks identical while listening and while
 * broken is a microphone people press twice and then give up on. `onFinal`
 * receives the settled text, once.
 *
 * Returns a stop function. Callers must be able to end it early: somebody who
 * pressed the button by accident should not have to finish a sentence.
 */
export function listenOnce({ lang, onInterim, onFinal, onError, onEnd } = {}) {
  const Engine = speechEngine();
  if (!Engine) {
    onError?.('This browser cannot listen. Type it instead.');
    onEnd?.();
    return () => {};
  }

  const rec = new Engine();
  rec.lang = lang || navigator.language || 'en-GB';
  rec.interimResults = true;
  // One sentence, not an open microphone. Continuous recognition in a shared
  // office is a device that keeps listening after the person has walked away.
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let settled = '';
  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) settled += chunk;
      else interim += chunk;
    }
    if (interim) onInterim?.(interim);
  };

  rec.onerror = (event) => {
    onError?.(errorText(event.error));
  };

  rec.onend = () => {
    if (settled.trim()) onFinal?.(settled.trim());
    onEnd?.();
  };

  try { rec.start(); } catch { /* already started; harmless */ }
  return () => { try { rec.stop(); } catch { /* already stopped */ } };
}

// Said as a thing to do about it, rather than as the error code.
function errorText(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'The microphone is blocked. Allow it in your browser, or type it instead.';
  }
  if (code === 'no-speech') return 'Nothing was heard. Try again, closer to the microphone.';
  if (code === 'audio-capture') return 'No microphone was found.';
  if (code === 'network') return 'Speech recognition needs a connection. Type it instead.';
  if (code === 'aborted') return '';
  return 'That did not come through. Try again, or type it instead.';
}
