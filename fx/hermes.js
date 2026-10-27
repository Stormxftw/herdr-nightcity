// Hermes Agent sessions for sidebar-fx.js: reads Hermes's own session store
// (%LOCALAPPDATA%\hermes\state.db, read-only) so Hermes cards get the same
// live stats as Claude cards, plus his subagents.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = process.env.HERMES_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'hermes');
const DB_PATH = path.join(HOME, 'state.db');
const ACTIVE = path.join(HOME, 'runtime', 'active_sessions.json');
// herdr often reports Hermes as idle while he (or a subagent) is busy, so any
// activity this recent counts as working.
const BUSY_MS = 20000;

let db = null;
let queries = null;

function open() {
  if (db) return true;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(DB_PATH, { readOnly: true });
    queries = {
      live: db.prepare(`SELECT * FROM sessions WHERE ended_at IS NULL AND parent_session_id IS NULL
        AND created_source = 'cli' AND started_at BETWEEN ? AND ?`),
      subs: db.prepare(`SELECT count(*) AS total, sum(ended_at IS NULL) AS live,
        max(CASE WHEN ended_at IS NULL THEN last_activity_at END) AS lastAt
        FROM sessions WHERE parent_session_id = ?`),
      lastTool: db.prepare(`SELECT tool_calls FROM messages WHERE session_id = ? AND role = 'assistant'
        ORDER BY id DESC LIMIT 1`),
    };
    return true;
  } catch {
    db = null;
    return false;
  }
}

// Live Hermes CLI sessions, oldest first. active_sessions.json has the
// process; state.db has the stats, matched by start time.
function liveSessions() {
  let entries;
  try { entries = JSON.parse(fs.readFileSync(ACTIVE, 'utf8')).entries || []; } catch { return []; }
  if (!open()) return [];
  const out = [];
  for (const e of entries.filter((x) => x.surface === 'cli').sort((a, b) => a.started_at - b.started_at)) {
    let row;
    try { row = queries.live.get(e.started_at - 5, e.started_at + 5); } catch { db = null; return []; }
    if (row) out.push(row);
  }
  return out;
}

// Pair Hermes panes with live sessions: same folder first, then in order.
function assign(panes) {
  const sessions = liveSessions();
  const map = new Map();
  const free = [...sessions];
  for (const a of panes) {
    const i = free.findIndex((s) => s.cwd && a.cwd && s.cwd.toLowerCase() === a.cwd.toLowerCase());
    if (i >= 0) map.set(a.pane_id, free.splice(i, 1)[0]);
  }
  for (const a of panes) if (!map.has(a.pane_id) && free.length) map.set(a.pane_id, free.shift());
  return map;
}

// A short label for what Hermes is doing right now.
function activityText(s, subs) {
  if (subs.live > 0) return `⑂ ${subs.live} subagent${subs.live > 1 ? 's' : ''}`;
  const d = (s.last_activity_description || '').replace(/^delegate_task:\s*/, '');
  if (/stream/.test(d)) return 'writing';
  if (/waiting|provider/.test(d)) return 'thinking';
  const tool = d.match(/tool (?:started|running|completed|call)[^:]*:\s*([\w.-]+)/i);
  if (tool) return `⚙ ${tool[1]}`;
  try {
    const calls = JSON.parse((queries.lastTool.get(s.id) || {}).tool_calls || '[]');
    const name = calls.length && (calls[0].function ? calls[0].function.name : calls[0].name);
    if (name) return `⚙ ${name}`;
  } catch { /* no tool calls */ }
  return 'thinking';
}

// Called once per poll with the Hermes panes; returns pane_id -> info.
function read(panes) {
  const info = new Map();
  if (!panes.length) return info;
  for (const [paneId, s] of assign(panes)) {
    let subs = { total: 0, live: 0, lastAt: null };
    try { subs = queries.subs.get(s.id) || subs; } catch { /* keep zeros */ }
    const lastAt = Math.max(s.last_activity_at || 0, subs.lastAt || 0) * 1000;
    info.set(paneId, {
      session: s,
      subs: { total: subs.total || 0, live: subs.live || 0 },
      busy: Date.now() - lastAt < BUSY_MS,
      activity: activityText(s, { live: subs.live || 0 }),
    });
  }
  return info;
}

module.exports = { read };
