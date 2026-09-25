// The prepared statements for the three KEYED tables — P1-T8, split out in P3-T7.
//
// `sqlite-store.ts` went over its 250-line limit when the config history became its third keyed
// table, and this is the coherent piece to lift out: every statement here is declared once, is
// parameterised (SEC-DATA-3), and is about a table that is upserted or deleted from rather than
// appended to. The append-and-page statements for `events`, `audit` and `vitals_snapshots` stay
// beside the methods that use them, because each is used in exactly one place and grouping them
// would say something about them that is not true.
//
// Nothing here executes. The store owns the handle, the transaction and the order.
import type { DatabaseSync, StatementSync } from 'node:sqlite';

/** The project registry's statements — P3-T1. See the field they are held in. */
export interface ProjectStatements {
  readonly upsert: StatementSync;
  readonly selectAll: StatementSync;
  readonly selectOne: StatementSync;
  readonly remove: StatementSync;
}

/**
 * The one UPSERT in the file, and three around it.
 *
 * The reason for `ON CONFLICT` is in the port: a project is keyed by its folder, so re-importing
 * one has to be the same row. `DO UPDATE` rather than `DO NOTHING`, and `imported_at` deliberately
 * left out of the update — the path and the name are re-displayed in whatever casing the
 * filesystem now uses, while "when did I add this" survives, because a second click on the same
 * folder is not a second decision.
 *
 * `selectAll` orders newest first, then by key, so two folders imported in the same millisecond
 * still have an order: a list that reshuffles between reads is one the deck cannot key a React row
 * from.
 */
export function prepareProjectStatements(db: DatabaseSync): ProjectStatements {
  return {
    upsert: db.prepare(
      `INSERT INTO projects (path_key, path, name, imported_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(path_key) DO UPDATE SET path = excluded.path, name = excluded.name`,
    ),
    selectAll: db.prepare(`SELECT * FROM projects ORDER BY imported_at DESC, path_key`),
    selectOne: db.prepare(`SELECT * FROM projects WHERE path_key = ?`),
    remove: db.prepare(`DELETE FROM projects WHERE path_key = ?`),
  };
}

/** The preset table's statements — P4-T1. Grouped for `ProjectStatements`' reason. */
export interface PresetStatements {
  readonly upsert: StatementSync;
  readonly selectAll: StatementSync;
  readonly selectOne: StatementSync;
  readonly remove: StatementSync;
  readonly removeForProject: StatementSync;
}

/**
 * The preset table's five.
 *
 * `selectAll` orders by project then name then id, which is `byProjectThenName` in SQL: the deck
 * draws these as a keyed React list under each project row, and a list that reshuffles between
 * reads is one React has to rebuild rather than reconcile.
 *
 * `removeForProject` is the cascade the port promises — forgetting a folder takes its presets with
 * it, because a preset names a folder to start a session in and a folder that is no longer
 * imported is one core may not read (SEC-FS-1).
 */
export function preparePresetStatements(db: DatabaseSync): PresetStatements {
  return {
    upsert: db.prepare(
      `INSERT INTO presets
         (project_key, id, name, profile_fn, cwd, session_name, prompt_source, prompt, preset_group,
          agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_key, id) DO UPDATE SET
         name = excluded.name, profile_fn = excluded.profile_fn, cwd = excluded.cwd,
         session_name = excluded.session_name, prompt_source = excluded.prompt_source,
         prompt = excluded.prompt, preset_group = excluded.preset_group, agent = excluded.agent`,
    ),
    selectAll: db.prepare(`SELECT * FROM presets ORDER BY project_key, name, id`),
    selectOne: db.prepare(`SELECT * FROM presets WHERE project_key = ? AND id = ?`),
    remove: db.prepare(`DELETE FROM presets WHERE project_key = ? AND id = ?`),
    removeForProject: db.prepare(`DELETE FROM presets WHERE project_key = ?`),
  };
}

/** The config-snapshot table's statements — P3-T7. Grouped for `ProjectStatements`' reason. */
export interface ConfigStatements {
  readonly insert: StatementSync;
  readonly selectLatest: StatementSync;
  readonly prune: StatementSync;
}

/**
 * Three, and the third is the bound.
 *
 * `selectLatest` orders by `id` rather than by `taken_at`: two snapshots written in the same
 * millisecond — which a test does, and a fast machine could — must still have an order, and the
 * one that matters is the order they were WRITTEN in. `prune` keeps the newest
 * `MAX_CONFIG_SNAPSHOTS` per project, which makes this table bounded by the number of imported
 * folders rather than by how long Flightdeck has been installed.
 */
export function prepareConfigStatements(db: DatabaseSync): ConfigStatements {
  return {
    insert: db.prepare(
      `INSERT INTO config_snapshots (project_key, taken_at, digest) VALUES (?, ?, ?)`,
    ),
    selectLatest: db.prepare(
      `SELECT * FROM config_snapshots WHERE project_key = ? ORDER BY id DESC LIMIT ?`,
    ),
    prune: db.prepare(
      `DELETE FROM config_snapshots WHERE project_key = ? AND id NOT IN
         (SELECT id FROM config_snapshots WHERE project_key = ? ORDER BY id DESC LIMIT ?)`,
    ),
  };
}

/** The mute table's statements — P6-T3. Grouped for `ProjectStatements`' reason. */
export interface MuteStatements {
  readonly upsert: StatementSync;
  readonly selectAll: StatementSync;
  readonly remove: StatementSync;
  readonly prune: StatementSync;
}

/**
 * Four, and the fourth is the bound.
 *
 * `DO UPDATE SET muted_at` rather than `DO NOTHING`, and it is the opposite choice from
 * `projects.imported_at` on purpose: muting a session that is already muted is not a second
 * decision either, but `muted_at` is not shown to anybody — it exists so `prune` can keep the
 * newest mutes and drop the oldest, and a row whose timestamp never moved would be evicted while
 * the owner was still using it.
 *
 * `selectAll` orders by `muted_at DESC, subscription, session_id`: `prune` takes its window from
 * the same ordering, so what survives a trim is what `selectAll` would have shown first.
 */
export function prepareMuteStatements(db: DatabaseSync): MuteStatements {
  return {
    upsert: db.prepare(
      `INSERT INTO session_mutes (subscription, session_id, muted_at) VALUES (?, ?, ?)
       ON CONFLICT(subscription, session_id) DO UPDATE SET muted_at = excluded.muted_at`,
    ),
    selectAll: db.prepare(
      `SELECT * FROM session_mutes ORDER BY muted_at DESC, subscription, session_id`,
    ),
    remove: db.prepare(`DELETE FROM session_mutes WHERE subscription = ? AND session_id = ?`),
    prune: db.prepare(
      `DELETE FROM session_mutes WHERE rowid NOT IN
         (SELECT rowid FROM session_mutes ORDER BY muted_at DESC, subscription, session_id LIMIT ?)`,
    ),
  };
}
