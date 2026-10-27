// subagent-view: live view of one Claude Code subagent, run in a herdr pane
// opened by subagents.js. Follows the subagent's transcript and shows one
// short line per step, its messages, and the final report.
// Mouse: wheel scrolls, right-click opens the menu. Keys: arrows/PgUp/PgDn/
// Home/End scroll, m opens the menu, d toggles details, Ctrl+C quits.
// Transcript text is untrusted (tool output, scanned documents), so escape
// sequences and control characters are stripped before anything is drawn.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { call, withState, prune, closeWindow } = require('./subagents');

const AGENT_ID = process.env.SUBAGENT_ID;
const AGENT_TYPE = process.env.SUBAGENT_TYPE || 'subagent';
const SESSION = process.env.SUBAGENT_SESSION;
const PARENT_PANE = process.env.SUBAGENT_PARENT_PANE;
const PANE = process.env.HERDR_PANE_ID;
let file = process.env.SUBAGENT_FILE;

const SOURCE = 'custom:subagent-view';
const POLL_MS = 250;
const META_MS = 1000;
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Night City palette (see frames.js).
const C = {
  pink: '#FF007C', cyan: '#00F0FF', yellow: '#FCEE0A', purple: '#BB9AF7',
  text: '#C0CAF5', dim: '#565F89', faint: '#3B4261', menuBg: '#1A1730', selBg: '#2E2A4F',
};
const fg = (hex) => `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;
const bg = (hex) => fg(hex).replace('[38;', '[48;');
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// ---- text safety and layout ----

function clean(s) {
  return String(s == null ? '' : s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '') // OSC
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')           // CSI
    .replace(/\x1b[PX^_][^\x1b]*(?:\x1b\\)?/g, '')      // DCS, SOS, PM, APC
    .replace(/\x1b./g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f‎‏‪-‮⁦-⁩]/g, '');
}

function charWidth(cp) {
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200d) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff)
    || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}

const width = (s) => [...s].reduce((n, ch) => n + charWidth(ch.codePointAt(0)), 0);

function cut(s, max) {
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > max) return max > 0 ? out.slice(0, -1) + '…' : '';
    out += ch;
    w += cw;
  }
  return out;
}

// Word-wrap one paragraph into lines no wider than `max`.
function wrap(text, max) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    let w = 0;
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const ww = width(word);
      if (w + ww <= max) { line += word; w += ww; continue; }
      if (/^\s+$/.test(word)) { lines.push(line); line = ''; w = 0; continue; }
      if (line.trim()) lines.push(line);
      line = '';
      w = 0;
      // Hard-split words longer than the line.
      for (const ch of word) {
        const cw = charWidth(ch.codePointAt(0));
        if (w + cw > max) { lines.push(line); line = ''; w = 0; }
        line += ch;
        w += cw;
      }
    }
    lines.push(line);
  }
  return lines;
}

// ---- transcript ----

const entries = []; // { kind: task|text|tool|error|result|report, text, name? }
let offset = 0;
let rest = '';
let tools = 0;
let started = null;
let lastAt = null;
let report = null;
let finishedByMeta = false;
let turnDone = false;
let description = null;
const toolNames = new Map(); // tool_use id -> name

function summarize(name, input) {
  const i = input || {};
  const pick = i.description || i.file_path || i.path || i.pattern || i.url || i.query || i.command || i.prompt || i.skill || '';
  if (name === 'Bash' || name === 'PowerShell') return i.description || i.command || '';
  if (name === 'Edit' || name === 'Write' || name === 'Read') return i.file_path || '';
  if (name === 'Grep') return `${i.pattern || ''}${i.path ? `  in ${i.path}` : ''}`;
  return typeof pick === 'string' ? pick : JSON.stringify(i);
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n');
  return '';
}

// Instructions Claude Code adds to every subagent prompt, not the task itself.
const HANDBACK_NOTE = /\s*Your final report is delivered through SubagentHandback[\s\S]*$/;
const isBoilerplate = (t) => /^\s*(<system-reminder>|Your final report is delivered through SubagentHandback)/.test(t || '');
const taskText = (t) => clean(String(t).replace(HANDBACK_NOTE, ''));

function ingest(e) {
  if (e.timestamp) {
    lastAt = Date.parse(e.timestamp);
    if (!started) started = lastAt;
  }
  const m = e.message;
  if (!m) return;
  if (e.type === 'user') {
    turnDone = false;
    if (typeof m.content === 'string') {
      if (!isBoilerplate(m.content)) entries.push({ kind: 'task', text: taskText(m.content) });
      return;
    }
    for (const b of m.content || []) {
      if (b.type === 'text' && !isBoilerplate(b.text)) entries.push({ kind: 'task', text: taskText(b.text) });
      if (b.type === 'tool_result') {
        const text = clean(resultText(b.content)).trim();
        entries.push({ kind: b.is_error ? 'error' : 'result', text, name: toolNames.get(b.tool_use_id) });
      }
    }
    return;
  }
  if (e.type !== 'assistant' || !Array.isArray(m.content)) return;
  let lastText = null;
  for (const b of m.content) {
    if (b.type === 'text' && b.text.trim()) entries.push((lastText = { kind: 'text', text: clean(b.text).trim() }));
    if (b.type === 'tool_use') {
      tools++;
      toolNames.set(b.id, b.name);
      if (b.name === 'SubagentHandback') {
        report = clean(b.input && b.input.message).trim();
        entries.push({ kind: 'report', text: report });
      } else {
        entries.push({ kind: 'tool', name: clean(b.name), text: clean(summarize(b.name, b.input)).replace(/\s+/g, ' ') });
      }
    }
  }
  if (m.stop_reason === 'end_turn') {
    turnDone = true;
    if (!report && lastText) {
      report = lastText.text;
      lastText.kind = 'report';
    }
  }
}

// Workflow subagents live deeper under subagents/, so search for the file.
function findFile() {
  if (file && fs.existsSync(file)) return file;
  const root = file ? file.slice(0, file.lastIndexOf('subagents') + 'subagents'.length) : null;
  if (!root) return null;
  const want = `agent-${AGENT_ID}.jsonl`;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      if (it.isDirectory()) stack.push(path.join(dir, it.name));
      else if (it.name === want) return (file = path.join(dir, it.name));
    }
  }
  return null;
}

function readNew() {
  if (!findFile()) return false;
  let size;
  try { size = fs.statSync(file).size; } catch { return false; }
  if (size <= offset) return false;
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(size - offset);
  fs.readSync(fd, chunk, 0, chunk.length, offset);
  fs.closeSync(fd);
  offset = size;
  const lines = (rest + chunk.toString('utf8')).split('\n');
  rest = lines.pop();
  for (const line of lines) {
    try { ingest(JSON.parse(line)); } catch { /* partial or odd line */ }
  }
  return true;
}

function readMeta() {
  if (!file) return;
  try {
    const meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
    if (meta.description) description = clean(meta.description);
    finishedByMeta = Boolean(meta.finished);
  } catch { /* not written yet */ }
}

const isDone = () => finishedByMeta || turnDone || Boolean(report && entries[entries.length - 1].kind === 'report');
const title = () => description || AGENT_TYPE;

// ---- herdr: card state, pane name, window state ----

let reported = null;
function reportState() {
  const state = isDone() ? 'idle' : 'working';
  const name = `${isDone() ? '✓' : '⑂'} ${cut(title(), 40)}`;
  if (reported && reported.state === state && reported.name === name) return;
  reported = { state, name };
  process.stdout.write(`\x1b]0;${name}\x07`);
  if (!PANE) return;
  call('pane.report_agent', {
    pane_id: PANE, source: SOURCE, agent: 'claude', state, seq: Date.now(),
    agent_session_id: AGENT_ID, ...(file ? { agent_session_path: file } : {}),
  });
  call('pane.rename', { pane_id: PANE, label: name });
  if (state === 'idle' && SESSION) {
    withState(SESSION, (s) => { const w = s.windows.find((x) => x.agentId === AGENT_ID); if (w) w.done = true; }).catch(() => {});
  }
}

// ---- screen ----

let showDetails = false;
let scroll = 0;       // lines up from the bottom; 0 follows live output
let lastTotal = 0;
let menu = null;      // { x, y, items, sel }
let toast = null;     // { text, until }
let tick = 0;
let dirty = true;

const cols = () => process.stdout.columns || 80;
const rows = () => process.stdout.rows || 24;

function bodyLines(w) {
  const out = [];
  const push = (text, color, prefix = '', prefixColor = color) => {
    const pw = width(prefix);
    wrap(text, Math.max(10, w - pw)).forEach((line, i) => {
      out.push({ prefix: i === 0 ? prefix : ' '.repeat(pw), prefixColor, text: line, color });
    });
  };
  for (const e of entries) {
    switch (e.kind) {
      case 'task': {
        const lines = e.text.split('\n');
        const shown = showDetails ? e.text : lines.slice(0, 3).join('\n') + (lines.length > 3 ? `\n… ${lines.length - 3} more lines (d: details)` : '');
        push(shown, C.dim, '▸ ', C.purple);
        out.push({ text: '' });
        break;
      }
      case 'text': push(e.text, C.text); out.push({ text: '' }); break;
      case 'tool':
        out.push({ prefix: `⚒ ${e.name} `, prefixColor: C.cyan, text: cut(e.text, Math.max(0, w - width(e.name) - 3)), color: C.dim });
        break;
      case 'error': push(e.text.split('\n')[0] || 'error', C.pink, '  ✗ ', C.pink); break;
      case 'result':
        if (showDetails && e.text) {
          const lines = e.text.split('\n');
          push(lines.slice(0, 6).join('\n') + (lines.length > 6 ? `\n… ${lines.length - 6} more lines` : ''), C.faint, '  │ ', C.faint);
        }
        break;
      case 'report':
        out.push({ text: '' });
        out.push({ text: `━━ report ${'━'.repeat(Math.max(0, w - 10))}`, color: C.yellow });
        push(e.text, C.text);
        break;
      default: break;
    }
  }
  return out;
}

function lineAt(row, col, text) {
  return `\x1b[${row};${col}H${text}`;
}

function duration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m${String(s % 60).padStart(2, '0')}s`;
}

function render() {
  const W = cols();
  const H = rows();
  const done = isDone();
  let out = '\x1b[?25l';
  // Header
  const mark = done ? `${fg(C.yellow)}✓` : `${fg(C.pink)}${SPIN[tick % SPIN.length]}`;
  out += lineAt(1, 1, `\x1b[2K${mark} ${BOLD}${fg(C.purple)}${cut(title(), W - 3)}${RESET}`);
  const age = started ? duration((done ? lastAt : Date.now()) - started) : '…';
  const status = [done ? 'done' : 'working', AGENT_TYPE, age, `${tools} tools`].join(' · ');
  out += lineAt(2, 1, `\x1b[2K${fg(C.dim)}${cut(status, W)}${RESET}`);
  out += lineAt(3, 1, `\x1b[2K${fg(C.faint)}${'─'.repeat(W)}${RESET}`);
  // Body
  const body = bodyLines(W);
  const viewH = Math.max(1, H - 4);
  if (scroll > 0 && body.length > lastTotal) scroll += body.length - lastTotal; // hold position while reading
  lastTotal = body.length;
  scroll = Math.min(scroll, Math.max(0, body.length - viewH));
  const start = Math.max(0, body.length - viewH - scroll);
  const visible = body.slice(start, start + viewH);
  if (!file || (!entries.length && !fs.existsSync(file))) visible.push({ text: 'waiting for the subagent to start…', color: C.dim });
  for (let r = 0; r < viewH; r++) {
    const l = visible[r];
    let text = '';
    if (l) {
      if (l.prefix) text += `${fg(l.prefixColor || C.text)}${l.prefix}`;
      text += `${fg(l.color || C.text)}${cut(l.text, W - width(l.prefix || ''))}`;
    }
    out += lineAt(4 + r, 1, `\x1b[2K${text}${RESET}`);
  }
  // Footer
  let foot;
  if (toast && toast.until > Date.now()) foot = [C.yellow, toast.text];
  else if (scroll > 0) foot = [C.cyan, `↓ ${scroll} lines below · End to follow`];
  else foot = [C.faint, 'right-click: menu · wheel: scroll · d: details'];
  out += lineAt(H, 1, `\x1b[2K${fg(foot[0])}${cut(foot[1], W)}${RESET}`);
  if (menu) out += drawMenu();
  process.stdout.write(out);
  dirty = false;
}

// ---- menu ----

function menuItems() {
  const items = [];
  items.push({ label: report ? 'Copy report' : 'Copy latest message', run: copyReport });
  items.push({ label: 'Copy whole log', run: copyLog });
  items.push({ label: 'Open transcript file', run: openTranscript });
  items.push(null);
  items.push({ label: showDetails ? 'Hide details' : 'Show details', run: () => { showDetails = !showDetails; } });
  items.push(scroll > 0 ? { label: 'Follow live', run: () => { scroll = 0; } } : { label: 'Jump to start', run: () => { scroll = Infinity; } });
  if (PARENT_PANE) items.push({ label: 'Go to parent agent', run: () => call('pane.focus', { pane_id: PARENT_PANE }) });
  items.push(null);
  items.push({ label: kept ? 'Let cleanup close this' : 'Keep this window open', run: toggleKeep });
  items.push({ label: 'Close other finished windows', run: closeFinished });
  items.push({ label: 'Close this window', run: closeSelf });
  return items;
}

function openMenu(x, y) {
  const items = menuItems();
  const w = Math.max(...items.filter(Boolean).map((i) => width(i.label))) + 4;
  const h = items.length + 2;
  menu = {
    items, w, h,
    x: Math.max(1, Math.min(x, cols() - w + 1)),
    y: Math.max(1, Math.min(y, rows() - h + 1)),
    sel: 0,
  };
  dirty = true;
}

function drawMenu() {
  const { items, w, x, y, sel } = menu;
  const B = `${bg(C.menuBg)}${fg(C.purple)}`;
  let out = lineAt(y, x, `${B}┌${'─'.repeat(w - 2)}┐`);
  items.forEach((it, i) => {
    const row = y + 1 + i;
    if (!it) { out += lineAt(row, x, `${B}├${'─'.repeat(w - 2)}┤`); return; }
    const label = ` ${it.label}${' '.repeat(Math.max(0, w - 3 - width(it.label)))}`;
    const style = i === sel ? `${bg(C.selBg)}${fg(C.cyan)}${BOLD}` : `${bg(C.menuBg)}${fg(C.text)}`;
    out += lineAt(row, x, `${B}│${style}${label}${RESET}${B}│`);
  });
  out += lineAt(y + items.length + 1, x, `${B}└${'─'.repeat(w - 2)}┘${RESET}`);
  return out;
}

function menuIndexAt(mx, my) {
  if (!menu) return -1;
  const i = my - menu.y - 1;
  if (mx < menu.x || mx >= menu.x + menu.w || i < 0 || i >= menu.items.length) return -1;
  return menu.items[i] ? i : -1;
}

function moveSel(d) {
  const n = menu.items.length;
  let i = menu.sel;
  do { i = (i + d + n) % n; } while (!menu.items[i]);
  menu.sel = i;
  dirty = true;
}

async function choose(i) {
  const it = menu && menu.items[i];
  menu = null;
  dirty = true;
  process.stdout.write('\x1b[2J');
  if (it) await it.run();
}

function say(text) {
  toast = { text, until: Date.now() + 2500 };
  dirty = true;
}

// ---- menu actions ----

function copy(text, what) {
  const tmp = path.join(os.tmpdir(), `subagent-${AGENT_ID}-clip.txt`);
  try { fs.writeFileSync(tmp, text, 'utf8'); } catch { return say('✗ could not copy'); }
  const ps = spawn('powershell', ['-NoProfile', '-Command', `Get-Content -Raw -Encoding UTF8 -LiteralPath '${tmp.replace(/'/g, "''")}' | Set-Clipboard`], { stdio: 'ignore', windowsHide: true });
  ps.on('exit', (code) => { try { fs.unlinkSync(tmp); } catch { /* gone */ } say(code === 0 ? `✓ copied ${what}` : '✗ could not copy'); });
}

function copyReport() {
  const last = report || [...entries].reverse().find((e) => e.kind === 'text');
  if (!last) return say('nothing to copy yet');
  copy(typeof last === 'string' ? last : last.text, report ? 'report' : 'latest message');
}

function copyLog() {
  const text = entries.map((e) => {
    if (e.kind === 'tool') return `⚒ ${e.name} ${e.text}`;
    if (e.kind === 'error') return `  ✗ ${e.text}`;
    if (e.kind === 'result') return null;
    if (e.kind === 'report') return `━━ report\n${e.text}`;
    return e.text;
  }).filter((x) => x != null).join('\n\n');
  copy(text, 'log');
}

function openTranscript() {
  if (!file || !fs.existsSync(file)) return say('no transcript yet');
  const hasCode = spawnSync('where', ['code'], { stdio: 'ignore', windowsHide: true }).status === 0;
  const child = hasCode
    ? spawn('cmd', ['/d', '/c', 'code', file], { detached: true, stdio: 'ignore', windowsHide: true })
    : spawn('notepad', [file], { detached: true, stdio: 'ignore' });
  child.unref();
  say(`opened in ${hasCode ? 'VS Code' : 'Notepad'}`);
}

let kept = false;
async function toggleKeep() {
  if (!SESSION) return;
  await withState(SESSION, (s) => {
    const w = s.windows.find((x) => x.agentId === AGENT_ID);
    if (w) { w.kept = !w.kept; kept = w.kept; }
  });
  say(kept ? '✓ kept: cleanup will leave this open' : 'cleanup can close this when done');
}

async function closeFinished() {
  if (!SESSION) return;
  const n = await withState(SESSION, async (s) => {
    await prune(s);
    const old = s.windows.filter((w) => w.done && !w.kept && w.agentId !== AGENT_ID);
    for (const w of old) await closeWindow(s, w);
    return old.length;
  });
  say(n ? `✓ closed ${n} finished window${n > 1 ? 's' : ''}` : 'no other finished windows');
}

async function closeSelf() {
  if (SESSION) await withState(SESSION, (s) => { s.windows = s.windows.filter((w) => w.agentId !== AGENT_ID); });
  restore();
  if (PANE) await call('pane.close', { pane_id: PANE });
  process.exit(0);
}

// ---- input ----

function onKey(k) {
  if (menu) {
    if (k === '\x1b' || k === 'q' || k === 'm') { menu = null; dirty = true; process.stdout.write('\x1b[2J'); return; }
    if (k === '\x1b[A' || k === 'k') return moveSel(-1);
    if (k === '\x1b[B' || k === 'j') return moveSel(1);
    if (k === '\r' || k === '\n') return choose(menu.sel);
    return;
  }
  const page = Math.max(1, rows() - 6);
  if (k === '\x1b[A' || k === 'k') scroll += 1;
  else if (k === '\x1b[B' || k === 'j') scroll = Math.max(0, scroll - 1);
  else if (k === '\x1b[5~') scroll += page;
  else if (k === '\x1b[6~') scroll = Math.max(0, scroll - page);
  else if (k === '\x1b[H' || k === '\x1b[1~' || k === 'g') scroll = Infinity;
  else if (k === '\x1b[F' || k === '\x1b[4~' || k === 'G') scroll = 0;
  else if (k === 'd') showDetails = !showDetails;
  else if (k === 'm') openMenu(Math.floor(cols() / 2) - 12, 4);
  else return;
  dirty = true;
}

function onMouse(b, x, y, press) {
  if (b >= 64) { // wheel
    if (menu) return;
    scroll = b & 1 ? Math.max(0, scroll - 3) : scroll + 3;
    dirty = true;
    return;
  }
  if (!press) return;
  const button = b & 3;
  if (menu) {
    const i = menuIndexAt(x, y);
    if (i >= 0 && button === 0) return choose(i);
    menu = null;
    dirty = true;
    process.stdout.write('\x1b[2J');
    if (button === 2) openMenu(x, y);
    return;
  }
  if (button === 2) openMenu(x, y);
}

function onData(data) {
  const s = data.toString('utf8');
  const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])|\x1b\[[0-9;]*[A-Za-z~]|\x1b|[\s\S]/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) onMouse(Number(m[1]), Number(m[2]), Number(m[3]), m[4] === 'M');
    else if (m[0] === '\x03') { restore(); process.exit(0); }
    else onKey(m[0]);
  }
}

// ---- lifecycle ----

function restore() {
  process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l');
  if (PANE) call('pane.release_agent', { pane_id: PANE, source: SOURCE, agent: 'claude', seq: Date.now() });
}

function main() {
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[?1000h\x1b[?1006h\x1b[?25l');
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('data', onData);
  process.stdout.on('resize', () => { process.stdout.write('\x1b[2J'); dirty = true; });
  process.on('exit', () => process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l'));
  readMeta();
  setInterval(() => { if (readNew()) dirty = true; }, POLL_MS);
  setInterval(() => { readMeta(); reportState(); }, META_MS);
  setInterval(() => {
    tick++;
    if (!isDone() || dirty || (toast && toast.until > Date.now() - 300)) render();
  }, 120);
  readNew();
  reportState();
  render();
}

main();
