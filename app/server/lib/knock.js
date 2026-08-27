const db = require('./db');
const { sendEmail } = require('./email');
const webPush = require('./webPush');

/**
 * Telling one person that something in Kairos wants them.
 *
 * ONE FUNCTION, TWO CHANNELS, ON PURPOSE. Before this there were two places
 * that knocked — a mention in a thread, and a note handed over on the pad — and
 * a third thing (a message landing on the direct line) that knocked not at all.
 * Adding push to each of them separately would have made three implementations
 * of one idea, and this codebase has already been bitten three times by two
 * pieces of code answering one question and drifting apart. So every knock in
 * the product comes through here, and adding a channel is one edit.
 *
 * WHY BOTH CHANNELS AND NOT A CHOICE BETWEEN THEM. They fail in opposite
 * directions. Email always arrives and is often read tomorrow — useless for
 * "the car is downstairs". A push arrives in seconds and only if that person
 * has an installed browser that has granted permission, which most will not on
 * the day they join. Neither alone is a way to reach somebody; together they
 * are, and the cost of the overlap is one duplicate notice.
 *
 * WHAT TRAVELS IN THE PUSH IS NOT WHAT TRAVELS IN THE EMAIL. The email is
 * already a knock rather than a transcript — the words stay in Kairos so the
 * answer can land beside them — and the push is more careful still: a title, a
 * name, and where to go. A notification is read by whoever is holding the
 * phone, and in this product the message is quite likely to be about where a
 * principal will be at three o'clock.
 *
 * AN AUTHOR IS OPTIONAL, and that is what lets the reminder sweep come through
 * here too. Most knocks are one person reaching another — a mention, a note
 * handed over — and the line reads "Ngozi Bello wrote to you in the office".
 * A deadline has nobody behind it: the app noticed the clock. Those knocks
 * carry the sentence alone. Before this, reminders went straight to sendEmail
 * and so reached an inbox and never a phone, which is the drift this file was
 * written to stop, happening in the one place it matters most: the whole point
 * of a deadline reminder is reaching somebody who is busy with something else.
 *
 * NEVER THROWS. Every caller is in the middle of something that has already
 * succeeded. A mail server or a push service having a bad afternoon must not
 * undo a message that is saved.
 */
async function knock({
  toUserId,
  ownerId,
  // The person behind this, or null when it is the app noticing a clock.
  author = null,
  subject,
  // The email's sentence: "<author.name> <line>", or just the line when
  // nobody is behind it.
  line,
  // Where in Kairos this is, so tapping the notification lands on it rather
  // than on the front door.
  url = '/today',
  category = 'mention',
  // One line per thing rather than a stack. A phone that has been in a pocket
  // should show the latest state of a deadline, not every time it was checked.
  tag = undefined,
}) {
  try {
    if (!toUserId) return;
    // Nobody needs telling about their own doing. Only ever a guard against a
    // person knocking on themselves — the app noticing a deadline is not that.
    if (author && toUserId === author.id) return;
    const to = await db.prepare('SELECT email FROM users WHERE id = ?').get(toUserId);
    const sentence = author ? `${author.name} ${line}` : line;

    if (to?.email) {
      await sendEmail({
        ownerId,
        sentByUserId: author?.id,
        toEmail: to.email,
        category,
        subject,
        body: author
          ? `${sentence}\n\nOpen Kairos to read it and reply.`
          : `${sentence}\n\nOpen Kairos to deal with it.`,
      });
    }

    // Deliberately after the email and never in place of it. A push that goes
    // nowhere — no device has granted permission, and on the day somebody joins
    // none has — must not be the only attempt that was made.
    await webPush.notify(toUserId, {
      title: subject,
      body: sentence,
      url,
      tag,
    });
  } catch { /* Something already saved does not fail over its notification. */ }
}

module.exports = { knock };
