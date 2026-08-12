const db = require('./db');

// Deleting an account, properly.
//
// Most rows would go on their own: the schema declares ON DELETE CASCADE on
// everything hanging off users(id) by ownership. But a handful of columns
// reference users(id) *without* cascade — created_by, author_id, assignee_id,
// decided_by and friends — because they record who did something rather than
// who owns it, and cascading there would delete a whole project because one
// contributor left. Those references are what make a bare DELETE fail.
//
// So this walks them explicitly, and the order matters: authorship is cleared
// or reassigned first, then the owned rows, then the user. Anything missed
// surfaces as a foreign-key error rather than silent partial deletion, which
// is why the whole thing runs in one transaction — a half-deleted account is
// far worse than a failed deletion.

/**
 * What disappears if this account is deleted, so the confirmation screen can
 * say it out loud instead of asking someone to take it on faith.
 */
async function summarizeAccount(userId) {
  const one = async (sql, ...args) => (await db.prepare(sql).get(userId, ...args))?.n || 0;

  const assistants = await one(
    "SELECT COUNT(*) AS n FROM memberships WHERE owner_id = ? AND status = 'active'",
  );
  const principals = await one(
    "SELECT COUNT(*) AS n FROM memberships WHERE member_user_id = ? AND status = 'active'",
  );

  return {
    bookings: await one("SELECT COUNT(*) AS n FROM bookings WHERE owner_id = ? AND status != 'cancelled'"),
    itineraryItems: await one('SELECT COUNT(*) AS n FROM itinerary_items WHERE owner_id = ?'),
    messages: await one('SELECT COUNT(*) AS n FROM messages WHERE author_id = ?'),
    // Unfinished work for other people, which goes; distinct from what they
    // have already put on a principal's calendar, which stays with that
    // principal. Saying which is which is the difference between an informed
    // decision and a nasty surprise.
    unfinishedForOthers: await one(`
      SELECT COUNT(*) AS n FROM itinerary_items
      WHERE created_by = ? AND owner_id != ? AND status IN ('draft', 'proposed')`, userId),
    handedBackToPrincipals: await one(`
      SELECT COUNT(*) AS n FROM itinerary_items
      WHERE created_by = ? AND owner_id != ? AND status = 'confirmed'`, userId),
    contacts: await one('SELECT COUNT(*) AS n FROM contacts WHERE owner_id = ?'),
    meetingTypes: await one('SELECT COUNT(*) AS n FROM meeting_types WHERE owner_id = ?'),
    spaces: await one('SELECT COUNT(*) AS n FROM spaces WHERE owner_id = ?'),
    // Named separately because these are other people. Deleting a principal's
    // account cuts off every assistant working for them, and deleting an
    // assistant's account is the principal losing help — neither should be a
    // surprise discovered afterwards.
    assistantsWhoLoseAccess: assistants,
    principalsYouWouldStopSupporting: principals,
  };
}

/**
 * Irreversible. Everything the user owns goes; their authorship of shared
 * material is severed rather than destroying that material.
 */
async function deleteAccount(userId) {
  await db.tx(async (tx) => {
    const run = (sql, ...args) => tx.prepare(sql).run(...args);

    // 1. Sever authorship on things other people still need.
    //
    // A record in a shared space, a task someone else is working on, a stage
    // in a live project: these outlive whoever typed them. Null the reference
    // where the column allows it, so the material survives with its author
    // shown as unknown rather than vanishing from under a colleague.
    await run('UPDATE messages SET promoted_by_id = NULL WHERE promoted_by_id = ?', userId);
    await run('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?', userId);
    await run('UPDATE project_stages SET owner_user_id = NULL WHERE owner_user_id = ?', userId);
    await run('UPDATE emails SET sent_by_user_id = NULL WHERE sent_by_user_id = ?', userId);
    await run('UPDATE itinerary_items SET decided_by = NULL WHERE decided_by = ?', userId);

    // 2. Hand back what an assistant made FOR someone else.
    //
    // This is the part that matters most and is easiest to get catastrophically
    // wrong. An assistant's account holds flights, briefs and standing
    // instructions belonging to the principals they run. Deleting by
    // `created_by` would take a principal's whole itinerary with them the day
    // their PA leaves — the principal turns up to an empty calendar because
    // somebody else closed an account.
    //
    // So anything finished, on someone else's account, is reassigned to that
    // account's owner. `created_by` is NOT NULL, and the owner is the truthful
    // holder of their own itinerary, so this loses nothing.
    await run(`
      UPDATE itinerary_items SET created_by = owner_id
      WHERE created_by = ? AND owner_id != ? AND status = 'confirmed'`, userId, userId);
    await run('UPDATE briefs SET created_by = owner_id WHERE created_by = ? AND owner_id != ?', userId, userId);
    await run('UPDATE instructions SET created_by = owner_id WHERE created_by = ? AND owner_id != ?', userId, userId);
    // Unfinished work is genuinely theirs and means nothing without them: a
    // half-arranged flight the principal has never seen is not an inheritance.
    await run(`
      DELETE FROM itinerary_items
      WHERE created_by = ? AND owner_id != ? AND status IN ('draft', 'proposed')`, userId, userId);

    // A task in someone else's space is a work item, not a statement of
    // authorship, so it survives under that space's owner.
    await run(`
      UPDATE tasks SET created_by = (SELECT s.owner_id FROM spaces s WHERE s.id = tasks.space_id)
      WHERE created_by = ? AND space_id NOT IN (SELECT id FROM spaces WHERE owner_id = ?)`, userId, userId);

    // 3. Delete what is genuinely theirs.
    //
    // Their own messages go with them — those are their words, and leaving
    // means leaving. Everything else here is scoped to their own account.
    await run(`DELETE FROM message_acks WHERE user_id = ?`, userId);
    await run(`DELETE FROM messages WHERE author_id = ?`, userId);
    await run(`DELETE FROM itinerary_items WHERE owner_id = ?`, userId);
    await run(`DELETE FROM briefs WHERE owner_id = ?`, userId);
    await run(`DELETE FROM instructions WHERE owner_id = ?`, userId);

    // 3. Threads, projects and stages inside spaces this user owns.
    await run(`
      DELETE FROM messages WHERE thread_id IN (
        SELECT t.id FROM threads t JOIN spaces s ON s.id = t.space_id WHERE s.owner_id = ?
      )`, userId);
    await run(`
      DELETE FROM tasks WHERE space_id IN (SELECT id FROM spaces WHERE owner_id = ?)`, userId);
    await run(`
      DELETE FROM threads WHERE space_id IN (SELECT id FROM spaces WHERE owner_id = ?)`, userId);
    await run(`
      DELETE FROM project_stages WHERE project_id IN (
        SELECT p.id FROM projects p JOIN spaces s ON s.id = p.space_id WHERE s.owner_id = ?
      )`, userId);
    await run(`
      DELETE FROM projects WHERE space_id IN (SELECT id FROM spaces WHERE owner_id = ?)`, userId);
    await run(`DELETE FROM space_members WHERE user_id = ?`, userId);
    await run(`DELETE FROM spaces WHERE owner_id = ?`, userId);

    // 4. Scheduling. Bookings first — itinerary items referencing them are
    //    already gone above, and contacts/meeting types hang off the user.
    await run(`DELETE FROM bookings WHERE owner_id = ?`, userId);
    await run(`DELETE FROM availability_rules WHERE owner_id = ?`, userId);
    await run(`DELETE FROM meeting_types WHERE owner_id = ?`, userId);
    await run(`DELETE FROM contacts WHERE owner_id = ?`, userId);
    await run(`DELETE FROM emails WHERE owner_id = ?`, userId);
    await run(`DELETE FROM calendar_connections WHERE owner_id = ?`, userId);
    await run(`DELETE FROM whatsapp_connections WHERE owner_id = ?`, userId);

    // 5. Relationships in both directions, then the account itself.
    await run(`DELETE FROM memberships WHERE owner_id = ? OR member_user_id = ?`, userId, userId);
    await run(`DELETE FROM password_resets WHERE user_id = ?`, userId);
    await run(`DELETE FROM sessions WHERE user_id = ?`, userId);
    await run(`DELETE FROM users WHERE id = ?`, userId);
  });
}

module.exports = { summarizeAccount, deleteAccount };
