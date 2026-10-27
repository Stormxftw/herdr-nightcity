// recap: a herdr popup (prefix+t) showing what every agent has been doing.
// Live state comes from herdr's agent.list; history from activity.jsonl,
// which sidebar-fx.js writes via activity.js.
'use strict';

const fs = require('fs');
const net = require('net');
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const { LOG } = require('./activity');
const { SPIN } = require('./frames');

const SOCKET = process.env.HERDR_SOCKET_PATH
  || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'herdr', 'herdr.sock');
const PIPE = process.platform === 'win32' ? `\\\\.\\pipe\\${SOCKET}` : SOCKET;
const WINDOW_MS = 24 * 3600 * 1000;
const REFRESH_MS = 5000;

// Same late-night neon palette as config.toml.
const C = {
  pink: '#FF007C', hot: '#FF2A6D', cyan: '#00F0FF', yellow: '#FCEE0A', purple: '#BB9AF7',
  dim: '#3B4261', mute: '#565F89', text: '#C0CAF5', green: '#73DACA', orange: '#FF9E64', blue: '#7DCFFF',
};
const AGENT_COLORS = {
  claude: C.purple, pi: C.cyan, hermes: '#FF79C6', grok: C.yellow, codex: C.green,
  opencode: C.blue, 'antigravity-cli': C.orange, devin: '#9ECE6A',
};
const GRADIENT = [C.cyan, '#7DCFFF', C.purple, '#E27AF0', '#FF79C6', C.hot, C.pink];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const fg = (h, s, bold) => `\x1b[${bold ? '1;' : ''}38;2;${hex(h).join(';')}m${s}\x1b[0m`;
const agentColor = (a) => AGENT_COLORS[a] || '#7AA2F7';

// Display width: CJK and fullwidth glyphs take two columns.
const charWidth = (ch) => (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1);
const width = (s) => [...s].reduce((n, ch) => n + charWidth(ch), 0);

// Pad or cut plain text to exactly `w` columns.
function cell(s, w) {
  s = String(s == null ? '' : s);
  if (width(s) <= w) return s + ' '.repeat(w - width(s));
  let out = '';
  for (const ch of s) {
    if (width(out) + charWidth(ch) > w - 1) break;
    out += ch;
  }
  return out + '…' + ' '.repeat(w - 1 - width(out));
}

function lerp(a, b, f) {
  const [x, y] = [hex(a), hex(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * f).toString(16).padStart(2, '0')).join('');
}

function divider(w, ch = '━') {
  let s = '';
  for (let i = 0; i < w; i++) {
    const p = (i / Math.max(1, w - 1)) * (GRADIENT.length - 1);
    const k = Math.min(GRADIENT.length - 2, Math.floor(p));
    s += fg(lerp(GRADIENT[k], GRADIENT[k + 1], p - k), ch);
  }
  return s;
}


function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return '<1m';
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// 12-hour times ("9:56 PM") and day names ("Today", "Yesterday") for readability.
const clock = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const hourLabel = (d) => `${d.getHours() % 12 || 12}${d.getHours() < 12 ? 'am' : 'pm'}`;
function dayName(t, now) {
  const day = (x) => new Date(x).toDateString();
  if (day(t) === day(now)) return 'Today';
  if (day(t) === day(now - 86400000)) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
const project = (cwd) => (cwd ? path.basename(cwd) || cwd : '?');

function listAgents() {
  return new Promise((resolve) => {
    const sock = net.connect(PIPE);
    let buf = '';
    sock.setEncoding('utf8');
    sock.setTimeout(2000, () => { sock.destroy(); resolve([]); });
    sock.on('connect', () => sock.write(JSON.stringify({ id: 'recap', method: 'agent.list', params: {} }) + '\n'));
    sock.on('data', (chunk) => {
      buf += chunk;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      sock.end();
      try { resolve(JSON.parse(buf.slice(0, i)).result.agents || []); } catch { resolve([]); }
    });
    sock.on('error', () => resolve([]));
  });
}

// Turns the status-change log into working runs: { agent, title, cwd, start, end, live }.
function loadRuns(now) {
  let text = '';
  try { text = fs.readFileSync(LOG, 'utf8'); } catch { /* nothing logged yet */ }
  const byPane = new Map();
  let first = null;
  let sample = false;
  for (const line of text.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (first == null) first = e.t;
    if (e.sample) sample = true;
    if (!byPane.has(e.pane)) byPane.set(e.pane, []);
    byPane.get(e.pane).push(e);
  }
  const runs = [];
  let blocked = 0;
  for (const events of byPane.values()) {
    events.sort((a, b) => a.t - b.t);
    let run = null;
    for (const e of events) {
      if (e.status === 'blocked' && e.t >= now - WINDOW_MS) blocked++;
      if (run && e.status !== 'working') { run.end = e.t; runs.push(run); run = null; }
      if (!run && e.status === 'working') run = { agent: e.agent, title: e.title, cwd: e.cwd, pane: e.pane, start: e.t };
      if (run && e.title) run.title = e.title;
    }
    if (run) { run.end = now; run.live = true; runs.push(run); }
  }
  return { runs: runs.filter((r) => r.end >= now - WINDOW_MS), blocked, since: first, sample };
}

// Node can't always read the terminal size inside a herdr pane on Windows, so
// fall back to the pane's rect from herdr (minus its border).
let paneSize = null;
function measure() {
  if (process.stdout.columns) return;
  const id = process.env.HERDR_PANE_ID;
  if (!id) return;
  try {
    const out = execFileSync(process.env.HERDR_BIN_PATH || 'herdr', ['pane', 'layout', '--pane', id], { encoding: 'utf8', timeout: 2000 });
    const pane = JSON.parse(out).result.layout.panes.find((p) => p.pane_id === id);
    if (pane) paneSize = { cols: pane.rect.width - 2, rows: pane.rect.height - 2 };
  } catch { /* keep the last size */ }
}

const STATUS = {
  working: (t) => fg(C.purple, `${SPIN[t % SPIN.length]} working  `, true),
  blocked: () => fg(C.pink, '◉ needs you', true),
  done: () => fg(C.green, '✓ done     ', true),
  idle: () => fg(C.dim, '◌ idle     '),
};

// Mouse state. `hits` maps a screen row (1-based) to what clicking it does.
let hits = new Map();
let hoverRow = 0;
let filter = null; // agent name RUNS is filtered to
let flash = null;  // { text, until } shown in the footer

const HOVER_BG = '\x1b[48;2;34;27;56m'; // active_row_bg from config.toml

function highlight(line, w) {
  const visible = width(line.replace(/\x1b\[[0-9;]*m/g, ''));
  return HOVER_BG + line.replace(/\x1b\[0m/g, `\x1b[0m${HOVER_BG}`) + ' '.repeat(Math.max(0, w - visible)) + '\x1b[0m';
}

function render(agents, history, now, t) {
  const W = Math.max(30, (process.stdout.columns || (paneSize && paneSize.cols) || 100) - 2);
  const H = process.stdout.rows || (paneSize && paneSize.rows) || 40;
  const wide = W >= 70; // narrow panes drop the project column
  const out = [];
  const pad = ' ';
  const act = new Map(); // out index -> click action
  const live = new Set(agents.map((a) => a.pane_id));

  // Header
  const left = `${fg(C.yellow, '⚡ AGENT RECAP', true)}  ${fg(C.pink, '▸ last 24h', true)}`;
  const rightText = `${dayName(now, now)} ${clock(now)}`;
  const gap = W - width('⚡ AGENT RECAP  ▸ last 24h') - width(rightText);
  out.push(pad + left + (gap >= 1 ? ' '.repeat(gap) + fg(C.mute, rightText) : ''));
  out.push(pad + divider(W));
  if (history.sample) out.push(pad + fg(C.yellow, cell('  SAMPLE DATA: history below is made up', W), true));
  out.push('');

  // Now
  out.push(pad + fg(C.cyan, '▌NOW', true) + fg(C.dim, `  ${agents.length} open`));
  if (!agents.length) out.push(pad + fg(C.mute, '  no agents running'));
  const order = { blocked: 0, working: 1, done: 2, idle: 3 };
  for (const a of [...agents].sort((x, y) => (order[x.agent_status] ?? 4) - (order[y.agent_status] ?? 4))) {
    const st = (STATUS[a.agent_status] || STATUS.idle)(t);
    const name = a.name || (a.tokens && a.tokens.title) || a.terminal_title_stripped || '';
    const proj = wide ? `▸ ${project(a.cwd)}` : '';
    const titleW = Math.max(4, W - 2 - 11 - 2 - 10 - (wide ? 2 + width(proj) : 0));
    act.set(out.length, { type: 'focus', pane: a.pane_id });
    out.push(`${pad}  ${st}  ${fg(agentColor(a.agent), cell(a.agent || 'shell', 10), true)}${fg(C.text, cell(name, titleW))}${wide ? '  ' + fg(C.blue, proj) : ''}`);
  }
  out.push('');

  const { runs, blocked, since } = history;
  if (!runs.length) {
    out.push(pad + fg(C.cyan, '▌TIMELINE', true));
    out.push(pad + fg(C.mute, since
      ? `  no work logged in the last 24h · logging since ${new Date(since).toLocaleString()}`
      : '  no history yet · sidebar-fx starts logging now, check back after some work'));
  } else {
    // Timeline: one row per agent, 30-minute (or hourly) slots ending now.
    const labelW = 10;
    const slots = W - 2 - labelW >= 48 ? 48 : W - 2 - labelW >= 24 ? 24 : 12;
    const slotMs = WINDOW_MS / slots;
    const startT = now - WINDOW_MS;
    out.push(pad + fg(C.cyan, '▌TIMELINE', true));
    out.push(pad + fg(C.mute, cell(`  each block = ${duration(slotMs)}   █ = working   · = not working`, W)));
    out.push(pad + fg(C.mute, cell('  left = 24 hours ago, right = now', W)));
    // Ruler: a label every 6 hours at the block where that hour starts, and "now" at the end.
    const ruler = Array(slots).fill(' ');
    let free = 0;
    const place = (i, text) => {
      if (i < free || i + text.length > slots) return;
      [...text].forEach((ch, k) => { ruler[i + k] = ch; });
      free = i + text.length + 1;
    };
    for (let i = 0; i < slots; i++) {
      const s0 = startT + i * slotMs;
      const top = new Date(Math.ceil(s0 / 3600000) * 3600000); // next whole hour
      if (top.getTime() < s0 + slotMs && top.getHours() % 6 === 0) place(i, hourLabel(top));
    }
    free = Math.min(free, slots - 3);
    place(slots - 3, 'now');
    out.push(`${pad}  ${' '.repeat(labelW)}${fg(C.text, ruler.join(''))}`);
    const agentNames = [...new Set(runs.map((r) => r.agent))].sort();
    for (const name of agentNames) {
      let row = '';
      for (let i = 0; i < slots; i++) {
        const s0 = startT + i * slotMs;
        const s1 = s0 + slotMs;
        let busy = 0;
        for (const r of runs) if (r.agent === name) busy += Math.max(0, Math.min(r.end, s1) - Math.max(r.start, s0));
        row += busy <= 0 ? fg(C.dim, '·') : fg(agentColor(name), '█');
      }
      act.set(out.length, { type: 'filter', agent: name });
      const label = filter === name ? fg(C.text, cell(`▸ ${name}`, labelW), true) : fg(agentColor(name), cell(name, labelW), true);
      out.push(`${pad}  ${label}${row}`);
    }
    out.push('');

    // Projects: time per working directory.
    const projects = new Map();
    for (const r of runs) {
      const p = projects.get(project(r.cwd)) || { ms: 0, agents: new Set() };
      p.ms += Math.min(r.end, now) - Math.max(r.start, startT);
      p.agents.add(r.agent);
      projects.set(project(r.cwd), p);
    }
    out.push(pad + fg(C.cyan, '▌PROJECTS', true));
    // One line per project when narrow, otherwise as many as fit on one line.
    const items = [...projects].sort((a, b) => b[1].ms - a[1].ms).slice(0, 6).map(([name, p]) => ({
      plain: `${name} ${duration(p.ms)} (${[...p.agents].join(', ')})`,
      text: `${fg(C.blue, name, true)} ${fg(C.green, duration(p.ms))} ${fg(C.mute, `(${[...p.agents].join(', ')})`)}`,
    }));
    let line = [];
    let used = 0;
    for (const it of items) {
      const w = width(it.plain) + (line.length ? 5 : 0);
      if (line.length && used + w > W - 2) { out.push(pad + '  ' + line.join(fg(C.dim, '  ░  '))); line = []; used = 0; }
      line.push(width(it.plain) > W - 2 ? fg(C.blue, cell(it.plain, W - 2)) : it.text);
      used += width(it.plain) + (line.length > 1 ? 5 : 0);
    }
    if (line.length) out.push(pad + '  ' + line.join(fg(C.dim, '  ░  ')));
    out.push('');

    // Runs, newest first, as many as fit.
    out.push(pad + fg(C.cyan, '▌RUNS', true) + (filter ? fg(C.mute, `  ${filter} only · click it again to clear`) : ''));
    const room = Math.max(3, H - out.length - 4);
    const titleW = Math.max(4, W - 2 - 10 - 10 - 2 - 16 - (wide ? 2 + 16 : 0));
    const shown = runs.filter((r) => !filter || r.agent === filter);
    let lastDay = null;
    for (const r of shown.sort((a, b) => b.start - a.start)) {
      if (out.length >= H - 4) break;
      const day = dayName(r.start, now);
      if (day !== lastDay) { out.push(`${pad}  ${fg(C.text, day, true)}`); lastDay = day; }
      act.set(out.length, live.has(r.pane) ? { type: 'focus', pane: r.pane } : { type: 'gone' });
      const dur = r.live ? fg(C.purple, cell(`running ${duration(r.end - r.start)}`, 16), true) : fg(C.green, cell(`for ${duration(r.end - r.start)}`, 16));
      out.push(`${pad}  ${fg(C.text, cell(clock(r.start), 10))}${fg(agentColor(r.agent), cell(r.agent, 10), true)}`
        + `${fg(C.text, cell(r.title || 'untitled', titleW))}  ${dur}${wide ? '  ' + fg(C.blue, cell(project(r.cwd), 16)) : ''}`);
    }
  }

  // Footer
  const total = runs.reduce((n, r) => n + (r.end - Math.max(r.start, now - WINDOW_MS)), 0);
  const stats = cell(` ${new Set(runs.map((r) => r.agent)).size} agents · ${runs.length} runs · ${duration(total)} working · ${blocked} needs-you `, W - 2).trimEnd() + ' ';
  while (out.length < H - 3) out.push('');
  out.push(pad + fg(C.dim, '──') + fg(C.orange, stats) + fg(C.dim, '─'.repeat(Math.max(0, W - 2 - width(stats)))));
  const note = flash && flash.until > now ? fg(C.pink, `   ${flash.text}`) : '';
  act.set(out.length, { type: 'buttons' }); // [r] at cols 2-12, [q] at 15-23
  out.push(pad + fg(C.cyan, '[r]') + fg(C.mute, ' refresh  ') + fg(C.pink, '[q]') + fg(C.mute, ' close') + note);

  hits = new Map([...act].map(([i, a]) => [i + 1, a]));
  const lines = out.map((l, i) => (i + 1 === hoverRow && act.has(i) && act.get(i).type !== 'buttons' ? highlight(l, W + 1) : l));
  return '\x1b[H\x1b[2J' + lines.join('\n');
}

let agents = [];
let history = { runs: [], blocked: 0, since: null };
let tick = 0;

async function refresh() {
  const now = Date.now();
  measure();
  agents = await listAgents();
  history = loadRuns(now);
}

function draw() {
  process.stdout.write(render(agents, history, Date.now(), tick++));
}

// Mouse: 1000 = clicks, 1003 = motion (for hover), 1006 = SGR coordinates.
const MOUSE_ON = '\x1b[?1000h\x1b[?1003h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1006l\x1b[?1003l\x1b[?1000l';

// As the prefix+t popup, jumping to a pane closes the recap; in a normal pane it stays open.
const POPUP = process.argv.includes('--popup');
const EXIT_LOG = path.join(path.dirname(LOG), 'recap-exit.log');

function quit(reason) {
  try { fs.appendFileSync(EXIT_LOG, `${new Date().toISOString()} ${reason}\n`); } catch { /* best effort */ }
  process.stdout.write(MOUSE_OFF + '\x1b[0m\x1b[?25h\x1b[H\x1b[2J');
  process.exit(0);
}

async function reload() {
  await refresh();
  draw();
}

function focusPane(pane) {
  try {
    execFileSync(process.env.HERDR_BIN_PATH || 'herdr', ['agent', 'focus', pane], { encoding: 'utf8', timeout: 2000 });
    if (POPUP) quit(`jumped to ${pane}`);
  } catch {
    flash = { text: 'could not jump to that pane', until: Date.now() + 2500 };
  }
}

// x and y are 1-based screen cells.
function click(x, y) {
  const a = hits.get(y);
  if (!a) return;
  if (a.type === 'focus') focusPane(a.pane);
  else if (a.type === 'filter') filter = filter === a.agent ? null : a.agent;
  else if (a.type === 'gone') flash = { text: 'that pane is closed now', until: Date.now() + 2500 };
  else if (a.type === 'buttons') {
    if (x >= 2 && x <= 12) reload();
    else if (x >= 15 && x <= 23) quit('clicked [q]');
  }
}

// Mouse reports can arrive split across reads, so keep any unfinished escape
// sequence and finish it with the next chunk. Returns the leftover key input.
let pending = '';
function handleMouse(data) {
  data = pending + data;
  pending = '';
  const tail = data.match(/\x1b(\[(<[\d;]*)?)?$/);
  if (tail) { pending = tail[0]; data = data.slice(0, tail.index); }
  for (const [, b, x, y, kind] of data.matchAll(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g)) {
    const button = Number(b);
    if (button & 32) hoverRow = Number(y);           // motion
    else if (button === 0 && kind === 'M') click(Number(x), Number(y));
  }
  return data.replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, '');
}

async function main() {
  process.stdout.write('\x1b[?25l' + MOUSE_ON);
  await refresh();
  draw();
  setInterval(draw, 120); // keeps the spinners turning
  setInterval(refresh, REFRESH_MS);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (k) => {
    // Only plain q and Ctrl+C quit; a stray Esc or Enter (from mouse codes or pastes) never does.
    const key = handleMouse(k.toString()).replace(/\x1b\[20[01]~/g, '').trim();
    if (key === 'r') reload();
    else if (key === 'q') quit('pressed q');
    else if (key === '\x03') quit('pressed ctrl+c');
  });
  process.stdout.on('resize', draw);
}

main();
