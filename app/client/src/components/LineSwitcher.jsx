import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useVisiblePoll } from '../lib/useVisiblePoll.js';

/**
 * Your other conversations, from inside the one you are in.
 *
 * THE PROBLEM IT SOLVES. Kairos grew three kinds of room at three different
 * times and never grew a place to see them together — the office room was one
 * tap from Today, a private line existed only if you remembered whose name to
 * click, and a peer line lived on the Connections screen. So somebody deep in a
 * conversation with their principal had no way to know an assistant had asked
 * them something privately half an hour ago.
 *
 * A SWITCHER, NOT A MERGE, and that is the whole design. The office room holds
 * the principal AND every active assistant. Folding private lines into it would
 * put a conversation between two people in front of everybody — which is both
 * the leak a pair room exists to prevent and the end of the general room being
 * general. Here the rooms stay separate and switching costs one tap.
 *
 * WHAT SHOWS: who, what was last said, and how much is waiting on you. Enough
 * to decide whether to go, which is the only decision this strip supports.
 */
export default function LineSwitcher({ threadId }) {
  const navigate = useNavigate();
  const [lines, setLines] = useState(null);

  function load() {
    api.get('/lines').then((d) => setLines(d.lines || [])).catch(() => {});
  }
  useEffect(load, []);
  // Same rule as everything else that polls: only while somebody is looking.
  useVisiblePoll(load, 15000);

  // Nothing to switch between is nothing to draw. A principal working alone has
  // one room, and a strip with one chip in it is furniture.
  if (!lines || lines.length < 2) return null;

  return (
    <div className="line-switcher" role="tablist" aria-label="Your conversations">
      {lines.map((l) => {
        const here = l.threadId === threadId;
        return (
          <button
            key={l.threadId}
            type="button"
            role="tab"
            aria-selected={here}
            className={'line-chip' + (here ? ' is-here' : '') + (l.isPrivate ? ' is-private' : '')}
            onClick={() => !here && navigate(`/threads/${l.threadId}`)}
          >
            <span className="line-chip-name">{l.name}</span>
            {/* Only ever what is UNANSWERED — see lib/threadSummary.js for why
                that is a different and more useful number than unread. */}
            {l.unread > 0 && !here && (
              <span className="line-chip-count">{l.unread}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
