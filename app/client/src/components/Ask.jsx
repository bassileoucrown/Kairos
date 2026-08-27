import { useCallback, useEffect, useRef, useState } from 'react';
import PasswordField from './PasswordField.jsx';

// Asking somebody for one thing, in the app rather than in the browser.
//
// This replaces window.prompt, which was doing two jobs badly.
//
// FOR A SECRET IT WAS ACTIVELY WRONG. A browser prompt does not mask what is
// typed, so a password went on screen in front of whoever was in the room; no
// password manager can fill one; and a grey box demanding a password over a
// page is the exact shape of every phishing dialog ever built. Asking a
// principal to type the password to their own document vault into that is not
// something a custody product can do.
//
// FOR A NOTE IT WAS MERELY BAD. One line, no room, no formatting, and the
// dialog is styled by the operating system, so the most careful screen in the
// app was interrupted by something that looked like an error.
//
// The shape is deliberately the same as the thing it replaces — `await ask()`
// returns what was typed, or null if they backed out — so the call sites read
// the way they did before and nobody has to restructure a handler to ask a
// question.

function AskDialog({ request, onAnswer }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const { title, label, hint, secret, multiline, optional, confirmLabel, initial } = request;

  useEffect(() => {
    // Prefilled where the caller has something to edit rather than something
    // to supply. Editing a note you cannot see is not editing — it is retyping
    // from memory, and the note exists precisely because nobody remembers.
    // Never for a secret: a password field that arrives full is a password
    // sitting on screen.
    setValue(secret ? '' : (initial || ''));
    // Focus on open: this is a question, and a question that needs a click
    // before it can be answered is a question asked badly. The secret case
    // focuses itself, since PasswordField owns its input.
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [request]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onAnswer(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onAnswer]);

  const ready = optional || value.trim().length > 0;

  return (
    <div className="ask-scrim" role="presentation" onMouseDown={(e) => {
      // Only a click on the backdrop itself, not one that started inside the
      // card and drifted out while selecting text.
      if (e.target === e.currentTarget) onAnswer(null);
    }}>
      <form
        className="ask-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-title"
        onSubmit={(e) => { e.preventDefault(); if (ready) onAnswer(value); }}
      >
        <h2 id="ask-title">{title}</h2>
        {hint && <p className="hint">{hint}</p>}

        {/* PasswordField renders its own field and label, so the secret case
            is not wrapped in a second one. */}
        {secret ? (
          <PasswordField
            id="ask-input"
            label={label}
            value={value}
            autoComplete="current-password"
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
        <div className="field">
          <label htmlFor="ask-input">{label}</label>
          {multiline ? (
            <textarea
              id="ask-input"
              ref={inputRef}
              rows={3}
              value={value}
              maxLength={600}
              onChange={(e) => setValue(e.target.value)}
              // Enter should send a one-line answer and make a paragraph in a
              // note. Shift+Enter sends here, which is the convention.
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready) {
                  e.preventDefault();
                  onAnswer(value);
                }
              }}
            />
          ) : (
            <input
              id="ask-input"
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </div>
        )}

        <div className="ask-actions">
          <button className="btn btn-primary" type="submit" disabled={!ready}>
            {confirmLabel || 'Continue'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => onAnswer(null)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * `const [ask, askDialog] = useAsk()`.
 *
 * Call `await ask({ title, label, … })` for the answer, or null if they backed
 * out; render `{askDialog}` anywhere in the component.
 */
export function useAsk() {
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);

  const ask = useCallback((opts) => new Promise((resolve) => {
    resolver.current = resolve;
    setRequest({ ...opts, key: Date.now() });
  }), []);

  const answer = useCallback((value) => {
    setRequest(null);
    const done = resolver.current;
    resolver.current = null;
    if (done) done(value);
  }, []);

  const dialog = request ? <AskDialog request={request} onAnswer={answer} /> : null;
  return [ask, dialog];
}

export default useAsk;
