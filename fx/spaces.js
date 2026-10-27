// Spaces cards: a few plain lines, each shown only when it matters.
//   "3 agents working" / "1 agent needs you" / "all quiet"
//   "5 projects have unsaved work"  (repos in spaces.json; hidden when all saved)
//   "mem0 is down"                  (services in spaces.json; hidden while all are up)
// spaces.json is your own list (see spaces.example.json); without it these two lines stay hidden.
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const SETTINGS_FILE = path.join(__dirname, 'spaces.json');
const HERMES_GATEWAY = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'hermes', 'gateway_state.json');
const EMPTY = '~'; // config hides tokens with this value
const GIT_MS = 60000;
const HEALTH_MS = 10000;

// ── repos ───────────────────────────────────────────────────────────────────
let unsaved = 0;

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 15000 }, (err, out) => resolve(err ? null : out));
  });
}

function settings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}

// A repo counts when it has uncommitted changes or commits on no remote.
async function checkRepos() {
  const list = settings().repos || [];
  let count = 0;
  for (const r of list) {
    const status = await git(r.path, ['status', '--porcelain']);
    if (status === null) continue; // missing or not a repo
    const ahead = await git(r.path, ['rev-list', '--count', 'HEAD', '--not', '--remotes']);
    if (status.trim() || Number(ahead) > 0) count++;
  }
  unsaved = count;
}

// ── services ────────────────────────────────────────────────────────────────
let down = [];

function listening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(1000, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

function hermesGatewayUp() {
  try {
    const g = JSON.parse(fs.readFileSync(HERMES_GATEWAY, 'utf8'));
    if (g.gateway_state !== 'running') return false;
    process.kill(g.pid, 0); // throws if the process is gone
    return true;
  } catch { return false; }
}

// Each service is { name, port } (something listening on localhost) or
// { name, hermes: true } (the Hermes Agent gateway).
async function checkHealth() {
  const services = settings().services || [];
  const up = await Promise.all(services.map((s) => (s.hermes ? hermesGatewayUp() : listening(s.port))));
  down = services.filter((s, i) => !up[i]).map((s) => s.name);
}

// ── tokens ──────────────────────────────────────────────────────────────────
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// statuses: effective status of every agent in the workspace.
function tokens(statuses) {
  const working = statuses.filter((s) => s === 'working').length;
  const blocked = statuses.filter((s) => s === 'blocked').length;
  let now = 'all quiet';
  if (blocked) now = `${plural(blocked, 'agent needs', 'agents need')} you`;
  else if (working) now = `${plural(working, 'agent', 'agents')} working`;
  return {
    now,
    unsaved: unsaved ? `${plural(unsaved, 'project has', 'projects have')} unsaved work` : EMPTY,
    down: down.length ? `${down.join(' and ')} ${down.length === 1 ? 'is' : 'are'} down` : EMPTY,
  };
}

function start() {
  checkRepos();
  checkHealth();
  setInterval(checkRepos, GIT_MS);
  setInterval(checkHealth, HEALTH_MS);
}

module.exports = { start, tokens, EMPTY };
