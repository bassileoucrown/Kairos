const db = require('./db');

// The join between the two registers and the project spine.
//
// A stage's status is stored, not derived, so an owner can set it by hand and
// have that stick. But records override it, because a Blocker that everyone
// can see and the board still showing "active" is exactly the disconnect this
// product exists to remove. Filing a record is what actually moves the
// project — which is precisely what makes promoting a note worth doing.
//
// Rules, in order:
//   any open blocker            -> blocked
//   else an accepted sign-off   -> done
//   else, if it was auto-moved  -> back to active
//   else                        -> left alone (respects a manual not_started/active)

function syncStageFromRecords(stageId) {
  if (!stageId) return null;
  const stage = db.prepare('SELECT * FROM project_stages WHERE id = ?').get(stageId);
  if (!stage) return null;

  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN m.record_type = 'blocker'  AND m.record_status = 'open'     THEN 1 ELSE 0 END) AS open_blockers,
      SUM(CASE WHEN m.record_type = 'sign_off' AND m.record_status = 'accepted' THEN 1 ELSE 0 END) AS accepted_signoffs
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    WHERE t.stage_id = ? AND m.register = 'record'
  `).get(stageId);

  const openBlockers = counts?.open_blockers || 0;
  const acceptedSignoffs = counts?.accepted_signoffs || 0;

  let next;
  if (openBlockers > 0) next = 'blocked';
  else if (acceptedSignoffs > 0) next = 'done';
  else if (stage.status === 'blocked' || stage.status === 'done') next = 'active';
  else next = stage.status;

  if (next !== stage.status) {
    db.prepare('UPDATE project_stages SET status = ? WHERE id = ?').run(next, stageId);
  }
  return { from: stage.status, to: next, changed: next !== stage.status };
}

/** Resolves the stage a message belongs to, if any. */
function stageIdForThread(threadId) {
  const row = db.prepare('SELECT stage_id FROM threads WHERE id = ?').get(threadId);
  return row?.stage_id || null;
}

module.exports = { syncStageFromRecords, stageIdForThread };
