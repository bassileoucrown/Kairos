function formatForEmail(isoString, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(isoString));
}

/**
 * When a meeting starts and when it ends, in one phrase.
 *
 * Every confirmation used to name only the start, which reads as complete and
 * is not: somebody who has been given an hour and somebody who has been given
 * twenty minutes get the same sentence. The end is the half that tells them
 * what to plan after it.
 */
function rangeForEmail(startIso, endIso, timeZone) {
  const start = formatForEmail(startIso, timeZone);
  if (!endIso) return start;
  const until = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit',
  }).format(new Date(endIso));
  return `${start} until ${until}`;
}

module.exports = { formatForEmail, rangeForEmail };
