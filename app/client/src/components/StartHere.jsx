import { useState } from 'react';

// What the pilot is asking of a tester, on the screen they land on.
//
// A PA SIGNS IN TO AN EMPTY APP AND DOES NOT KNOW WHAT IS WANTED. That is the
// commonest way a pilot produces nothing: not that people dislike the product,
// but that nobody told them what to try, so they open it, look around, and go
// back to what they were doing. The findings that never arrive are the ones
// nobody was asked for.
//
// FOUR THINGS, NOT A TOUR. A checklist somebody can finish in a morning beats
// a walkthrough they abandon, and each of these produces a different kind of
// evidence: whether the daily shape works, whether the diary works, whether
// the office rooms work, whether the vault is trusted.
//
// AND IT SAYS WHAT IS BEING COLLECTED. Somebody whose profession is discretion
// is entitled to know that before they put a principal's week into it — and a
// tester who finds out later is a tester who stops.
//
// Dismissed in the browser rather than on the account: this is a nudge, not a
// state anybody should have to store, and the cost of it reappearing on a new
// device is one tap.

const STEPS = [
  ['Put a real week in the diary', 'Add the meetings you actually have. The point is whether it survives a real week, not a tidy one.'],
  ['Use it with your principal', 'Open the direct line and use it instead of WhatsApp for a day.'],
  ['Hand something over', 'Give a task to somebody and see whether it lands where you expect.'],
  ['Try the vault', 'Add one detail you get asked for constantly. Tell us if you would not trust it with more.'],
];

const KEY = 'kairos_start_here_done';

export default function StartHere() {
  const [gone, setGone] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  if (gone) return null;

  function dismiss() {
    setGone(true);
    try { localStorage.setItem(KEY, '1'); } catch { /* private window */ }
  }

  return (
    <div className="card start-here">
      <div className="start-here-head">
        <h3>You are trying Kairos before anybody else</h3>
        <button className="btn btn-sm" type="button" onClick={dismiss}>Hide this</button>
      </div>
      <p className="hint">
        It is a prototype, so some things are deliberately not built yet — those say so
        rather than failing. Four things worth doing in the first week:
      </p>
      <ol className="start-here-list">
        {STEPS.map(([what, why]) => (
          <li key={what}>
            <strong>{what}</strong>
            <span className="hint"> {why}</span>
          </li>
        ))}
      </ol>
      <p className="hint">
        When something confuses you or goes wrong, press <strong>Tell us</strong> at the
        bottom of any screen. It sends your name and which screen you were on — never
        anything you have written, and nothing from the vault, ever.
      </p>
    </div>
  );
}
