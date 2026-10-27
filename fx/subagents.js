// subagents: opens a herdr watch window for every Claude Code subagent.
// Claude Code runs this as a SubagentStart / SubagentStop hook inside the
// parent's herdr pane:
//   node subagents.js start|stop   (hook payload on stdin)
// Each parent session gets one "⑂ subagents" tab in its workspace; each
// subagent gets a pane there running subagent-view.js. When new subagents
// start, finished windows close (never running or kept ones), and at most
// MAX_WINDOWS stay open.
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');

const HERDR_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'herdr');
const STATE_DIR = path.join(HERDR_DIR, 'subagents');
const VIEWER = path.join(__dirname, 'subagent-view.js');
const TAB_LABEL = '⑂ subagents';
const MAX_WINDOWS = 4;
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 15000;

function pipePath() {
  const socket = process.env.HERDR_SOCKET_PATH || path.join(HERDR_DIR, 'herdr.sock');
  return process.platform === 'win32' ? `\\\\.\\pipe\\${socket}` : socket;
}

// herdr answers one request per connection, so each call opens its own.
// Resolves to the result, or null on any error.
let reqId = 0;
function call(method, params) {
  return new Promise((resolve) => {
    const id = `sub_${process.pid}_${++reqId}`;
    const sock = net.connect(pipePath());
    let buf = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; sock.destroy(); resolve(v); } };
    sock.setEncoding('utf8');
    sock.setTimeout(3000, () => finish(null));
    sock.on('connect', () => sock.write(JSON.stringify({ id, method, params }) + '\n'));
    sock.on('data', (chunk) => {
      buf += chunk;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      try {
        const msg = JSON.parse(buf.slice(0, i));
        finish(msg.error ? null : msg.result);
      } catch { finish(null); }
    });
    sock.on('error', () => finish(null));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- state: one file per parent session, guarded by a lock directory ----

function stateFile(sessionId) {
  return path.join(STATE_DIR, `${sessionId.replace(/[^\w-]/g, '')}.json`);
}

function readState(sessionId) {
  try { return JSON.parse(fs.readFileSync(stateFile(sessionId), 'utf8')); } catch { return { windows: [] }; }
}

function writeState(sessionId, state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = stateFile(sessionId);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

async function withState(sessionId, fn) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const lock = `${stateFile(sessionId)}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmdirSync(lock); } catch { /* gone */ }
      if (Date.now() > deadline) break; // run anyway rather than lose the window
      await sleep(50);
    }
  }
  try {
    const state = readState(sessionId);
    const out = await fn(state);
    writeState(sessionId, state);
    return out;
  } finally {
    try { fs.rmdirSync(lock); } catch { /* already released */ }
  }
}

// ---- windows ----

async function livePanes(workspaceId) {
  const r = await call('pane.list', { workspace_id: workspaceId });
  return r ? new Map(r.panes.map((p) => [p.pane_id, p])) : null;
}

// Forget windows whose panes are gone (closed by hand, or the tab closed).
async function prune(state) {
  const panes = await livePanes(state.workspaceId);
  if (!panes) return null;
  state.windows = state.windows.filter((w) => panes.has(w.paneId));
  if (state.tabId && !state.windows.length && ![...panes.values()].some((p) => p.tab_id === state.tabId)) state.tabId = null;
  return panes;
}

async function closeWindow(state, w) {
  await call('pane.close', { pane_id: w.paneId });
  state.windows = state.windows.filter((x) => x !== w);
}

// Close finished windows to make room: all of them when `all`, otherwise only
// the oldest ones beyond MAX_WINDOWS - 1 (leaving room for the new one).
async function cleanup(state, { all }) {
  const closable = state.windows.filter((w) => w.done && !w.kept).sort((a, b) => a.started - b.started);
  let excess = state.windows.length + 1 - MAX_WINDOWS;
  for (const w of closable) {
    if (!all && excess <= 0) break;
    await closeWindow(state, w);
    excess--;
  }
}

// Where the next pane goes: a 2x2 grid, then stack under the newest.
function splitPlan(state) {
  const ws = [...state.windows].sort((a, b) => a.started - b.started);
  if (ws.length === 1) return { target: ws[0].paneId, direction: 'right' };
  if (ws.length === 2) return { target: ws[0].paneId, direction: 'down' };
  if (ws.length === 3) return { target: ws[1].paneId, direction: 'down' };
  return { target: ws[ws.length - 1].paneId, direction: 'down' };
}

function viewerEnv(payload, file) {
  return {
    SUBAGENT_ID: payload.agent_id,
    SUBAGENT_TYPE: payload.agent_type || '',
    SUBAGENT_FILE: file,
    SUBAGENT_SESSION: payload.session_id,
    SUBAGENT_PARENT_PANE: process.env.HERDR_PANE_ID,
  };
}

function subagentFile(payload) {
  if (payload.agent_transcript_path) return payload.agent_transcript_path;
  const dir = path.join(path.dirname(payload.transcript_path), payload.session_id, 'subagents');
  return path.join(dir, `agent-${payload.agent_id}.jsonl`);
}

// Each parent session gets its own tab, so name it after the parent's title.
async function tabLabel() {
  const r = await call('pane.get', { pane_id: process.env.HERDR_PANE_ID });
  const title = r && r.pane && (r.pane.terminal_title_stripped || '').trim();
  return title ? `${TAB_LABEL} · ${title.slice(0, 28)}` : TAB_LABEL;
}

async function openWindow(state, payload) {
  const file = subagentFile(payload);
  const env = viewerEnv(payload, file);
  let paneId = null;
  if (!state.tabId || !state.windows.length) {
    // Reuse an empty subagents tab if one is left, otherwise make one.
    if (state.tabId) await call('tab.close', { tab_id: state.tabId });
    const r = await call('tab.create', { workspace_id: state.workspaceId, label: await tabLabel(), cwd: payload.cwd, env, focus: false });
    if (!r) return null;
    state.tabId = r.tab.tab_id;
    paneId = r.root_pane.pane_id;
    await call('pane.input.set', { pane_id: paneId, right_click: 'pane' });
  } else {
    const { target, direction } = splitPlan(state);
    const r = await call('pane.split', { target_pane_id: target, direction, cwd: payload.cwd, env, right_click: 'pane', focus: false });
    if (!r) return null;
    paneId = r.pane.pane_id;
  }
  await call('pane.rename', { pane_id: paneId, label: `⑂ ${payload.agent_type || 'subagent'}` });
  // The env above reaches the pane's shell; the shell starts the viewer.
  await call('pane.send_input', { pane_id: paneId, text: `node "${VIEWER.replace(/\\/g, '/')}"`, keys: ['enter'] });
  return paneId;
}

async function onStart(payload) {
  await withState(payload.session_id, async (state) => {
    state.workspaceId = state.workspaceId || process.env.HERDR_WORKSPACE_ID;
    state.parentPane = process.env.HERDR_PANE_ID;
    await prune(state);
    const known = state.windows.find((w) => w.agentId === payload.agent_id);
    if (known) { known.done = false; return; } // a resumed subagent keeps its window
    await cleanup(state, { all: true });
    const paneId = await openWindow(state, payload);
    if (paneId) state.windows.push({ agentId: payload.agent_id, paneId, started: Date.now(), done: false, kept: false });
  });
}

async function onStop(payload) {
  await withState(payload.session_id, async (state) => {
    const w = state.windows.find((x) => x.agentId === payload.agent_id);
    if (w) w.done = true;
  });
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

async function main() {
  const action = process.argv[2];
  if (!process.env.HERDR_PANE_ID || !process.env.HERDR_WORKSPACE_ID) return; // not in herdr
  let payload;
  try { payload = JSON.parse(readStdin()); } catch { return; }
  // Internal helper agents (prompt suggestions, /btw) have no agent type.
  if (!payload || !payload.agent_id || !payload.session_id || !payload.agent_type) return;
  if (action === 'start') await onStart(payload);
  else if (action === 'stop') await onStop(payload);
}

if (require.main === module) {
  main().catch(() => {}).finally(() => process.exit(0));
}

module.exports = { call, withState, prune, closeWindow, TAB_LABEL };
