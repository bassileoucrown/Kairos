/**
 * What is out of frame, and what is unreadable — measured in the page.
 *
 * SHARED BY TWO SUITES ON PURPOSE. blayout walks every screen as it loads;
 * bframe opens the things that only exist once somebody taps. Those are
 * different questions and need different fixtures, but they are the SAME
 * measurement, and two copies of it would drift — one would learn about a new
 * kind of overflow and the other would not. This codebase has been bitten by
 * that shape more than once.
 *
 * Not named b*.js, which is what allsuites.sh globs: this is a tool, not a
 * suite. Same reasoning as resetpg.js.
 *
 * FOUR FAILURES, and they need different measurements:
 *
 *   SIDEWAYS   the page is wider than the window, so somebody has to drag the
 *              whole layout left to reach a button — which on a phone means
 *              they usually do not reach it at all.
 *   SPILLING   an element wider than the box it was given, so its text runs
 *              out over whatever is beside it. This is what "the details are
 *              overlapping" looks like from the inside.
 *   SQUEEZED   the opposite, and invented by the fix for the last one:
 *              min-width:0 plus overflow-wrap:anywhere lets a box shrink and
 *              its text break anywhere, so beside a button that will not
 *              shrink it collapses to one letter per line. The page fits
 *              perfectly and cannot be read.
 *   SPRAWLING  a line of prose so long the eye loses its place returning to
 *              the left margin. Only ever a wide-screen fault, which is why
 *              it is measured only there — a phone cannot produce one.
 *
 * Everything is reported with the offending element named, because "the page
 * is too wide" is not something anybody can act on.
 */

/**
 * Runs inside the page. Takes the longest comfortable line in characters —
 * 0 turns that check off, which is what the phone widths want.
 */
const MEASURE = (maxChars = 0) => {
  const de = document.documentElement;
  const limit = de.clientWidth;

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    return (el.tagName.toLowerCase() + id + cls).slice(0, 80);
  };

  // "This box is handling its own overflow, leave it alone."
  //
  // hidden BELONGS IN THIS LIST and its absence was a bug in the measurement.
  // A one-line preview that truncates with an ellipsis — nowrap, overflow
  // hidden, text-overflow ellipsis — has a scrollWidth far beyond its
  // clientWidth BY DESIGN; that is what the ellipsis is. Reading that as text
  // running over its neighbour reported the direct line on Today as 177px
  // broken when it was doing exactly what it was told.
  const handlesItself = (el) => {
    const o = getComputedStyle(el).overflowX;
    return o === 'auto' || o === 'scroll' || o === 'hidden';
  };

  const scrollsSideways = (el) => {
    const o = getComputedStyle(el).overflowX;
    return o === 'auto' || o === 'scroll';
  };

  // A popover deliberately escapes the inline word it hangs off. Its parent's
  // scrollWidth then measures the popover rather than any text overrunning, so
  // the parent is not the one at fault — and the popover itself is checked on
  // its own terms, against the viewport, by the caller.
  const holdsAFloater = (el) => {
    for (const kid of el.children) {
      const pos = getComputedStyle(kid).position;
      if (pos === 'absolute' || pos === 'fixed') return true;
    }
    return false;
  };

  const insideAScroller = (el) => {
    for (let p = el.parentElement; p && p !== de; p = p.parentElement) {
      if (scrollsSideways(p)) return true;
    }
    return false;
  };

  const wide = [];
  const spilling = [];
  const squeezed = [];
  const sprawling = [];

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    // Pushing the page wider than the window.
    if (r.right > limit + 1 && !insideAScroller(el)) {
      wide.push({ what: describe(el), right: Math.round(r.right), over: Math.round(r.right - limit) });
    }

    if (el.children.length === 0) {
      const words = (el.textContent || '').trim();
      const size = parseFloat(cs.fontSize) || 14;
      // Roughly half the font size per character, which is close enough for
      // "is there room for a word here" and needs no font metrics.
      const perLine = r.width / (size * 0.5);

      // Crushed into a column too narrow to set a word in. Leaf elements only:
      // a wrapper is narrow because its child is, and naming both is noise.
      if (words.length >= 12) {
        const lines = Math.round(r.height / (parseFloat(cs.lineHeight) || size * 1.4));
        if (perLine < 6 && lines > 3) {
          squeezed.push({
            what: describe(el),
            width: Math.round(r.width),
            chars: words.length,
            lines,
            text: words.slice(0, 40),
          });
        }
      }

      // A line of prose too long to track back to. Only real paragraphs are
      // judged: a wide row of controls is not a measure line, and a heading
      // is read in one glance whatever its width.
      if (maxChars > 0 && words.length > maxChars && perLine > maxChars) {
        const tag = el.tagName.toLowerCase();
        const isProse = ['p', 'li', 'span', 'div', 'blockquote'].includes(tag);
        if (isProse) {
          sprawling.push({
            what: describe(el),
            width: Math.round(r.width),
            chars: Math.round(perLine),
            text: words.slice(0, 40),
          });
        }
      }
    }

    // Wider than its own box, with nowhere to scroll — this is the text that
    // runs over its neighbour.
    if (!handlesItself(el) && !holdsAFloater(el)
        && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const text = (el.textContent || '').trim().slice(0, 40);
      if (text) {
        spilling.push({ what: describe(el), by: el.scrollWidth - el.clientWidth, text });
      }
    }
  }

  return {
    overflow: Math.max(0, de.scrollWidth - limit),
    wide: wide.slice(0, 6),
    spilling: spilling.slice(0, 6),
    squeezed: squeezed.slice(0, 6),
    sprawling: sprawling.slice(0, 6),
  };
};

/** Everything wrong on this page, as lines somebody can act on. */
function faults(m) {
  const out = [];
  if (m.overflow > 1) {
    out.push(`scrolls sideways by ${m.overflow}px`
      + m.wide.map((el) => `\n        ${el.what}  (+${el.over}px)`).join(''));
  }
  for (const el of m.spilling) out.push(`${el.what} spills its box by ${el.by}px  "${el.text}"`);
  for (const el of m.squeezed) {
    out.push(`${el.what} crushed to ${el.width}px — ${el.chars} chars over ${el.lines} lines  "${el.text}"`);
  }
  for (const el of m.sprawling) {
    out.push(`${el.what} runs ${el.chars} characters wide  "${el.text}"`);
  }
  return out;
}

module.exports = { MEASURE, faults };
