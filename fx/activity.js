// Activity log: appends one JSON line per agent status change to
// %APPDATA%\herdr\activity.jsonl so recap.js can show who worked on what,
// and when, across every agent herdr detects (not just Claude).
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'herdr', 'activity.jsonl');
const KEEP_MS = 7 * 24 * 3600 * 1000; // trimmed on startup

const last = new Map(); // pane_id -> status

function append(e) {
  try { fs.appendFileSync(LOG, JSON.stringify(e) + '\n'); } catch { /* best effort */ }
}

// Drop entries older than a week so the file stays small.
function trim() {
  let text;
  try { text = fs.readFileSync(LOG, 'utf8'); } catch { return; }
  const cutoff = Date.now() - KEEP_MS;
  const kept = text.split('\n').filter((l) => {
    try { return JSON.parse(l).t >= cutoff; } catch { return false; }
  });
  try { fs.writeFileSync(LOG, kept.length ? kept.join('\n') + '\n' : ''); } catch { /* best effort */ }
}

// Call after every successful agent.list. `describe(a)` returns
// { status, title, model } using the richer Claude transcript data when there is some.
function track(agents, describe) {
  const now = Date.now();
  const seen = new Set();
  for (const a of agents) {
    seen.add(a.pane_id);
    const d = describe(a);
    if (last.get(a.pane_id) === d.status) continue;
    last.set(a.pane_id, d.status);
    const session = a.agent_session && a.agent_session.value;
    append({
      t: now, pane: a.pane_id, agent: a.agent || 'shell', status: d.status,
      title: d.title || null, model: d.model || null, cwd: a.cwd || null,
      workspace: a.workspace_id || null, session: session || null,
    });
  }
  for (const pane of last.keys()) {
    if (seen.has(pane)) continue;
    last.delete(pane);
    append({ t: now, pane, status: 'gone' });
  }
}

module.exports = { LOG, track, trim };
