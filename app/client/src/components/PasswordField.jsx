import { useId, useState } from 'react';

// A password box you can look at.
//
// Typing a long password blind, on a phone, at a gate, with an assistant
// waiting, is how people end up choosing short ones — or getting locked out and
// resetting, which costs more than the thing this protects. Every password box
// in the app goes through here so the behaviour is decided once.
//
// THE STATE IS NEVER REMEMBERED. It starts hidden every time the field is
// mounted, and there is nothing stored anywhere to make it start otherwise.
// Somebody who revealed their password on a shared laptop last week has not
// left it revealed for whoever sits down next.
//
// THE BUTTON SAYS WHAT PRESSING IT DOES, and the accessible name says the same
// thing as the visible word. The lesson is from SoonButton: a control whose
// label and announced state disagree is worse than one with no label at all.
// It is type="button" so it can never submit the form it sits in — a
// show-password toggle that logs you in is a real bug people ship.
//
// It is a plain word rather than an eye glyph on purpose. An eye with a line
// through it is ambiguous in exactly the moment it matters: does the line mean
// hidden, or does pressing it hide?

export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  required = false,
  minLength,
  hint,
  labelAside = null,
  autoFocus = false,
  disabled = false,
}) {
  const [shown, setShown] = useState(false);
  const fallbackId = useId();
  const inputId = id || fallbackId;

  return (
    <div className="field">
      {(label || labelAside) && (
        <div className="field-label-row">
          {label && <label htmlFor={inputId}>{label}</label>}
          {labelAside}
        </div>
      )}
      <div className="password-field">
        <input
          id={inputId}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          required={required}
          minLength={minLength}
          // Kept even while revealed. A browser that has offered to fill this
          // box should go on offering, and switching the type is a display
          // decision rather than a change of what the box is for.
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShown((s) => !s)}
          aria-controls={inputId}
          aria-label={shown ? 'Hide password' : 'Show password'}
          title={shown ? 'Hide password' : 'Show password'}
          disabled={disabled}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
