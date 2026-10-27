// equalize: makes every pane in a herdr tab the same size.
//
//   node equalize.js            keep the arrangement, even out every row and column
//   node equalize.js grid       rearrange into a balanced grid that fits the window
//   node equalize.js grid --cols 3   or --rows 2: grid with a fixed column/row count
//
// Options: --tab <id> targets a tab (default: the focused one), --session <name>
// targets a named herdr session, --quiet skips the toast.
// Runs as the joe.equalize plugin (keybindings in build-config.js) or from any shell.
'use strict';

const net = require('net');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const mode = args[0] === 'grid' ? 'grid' : 'even';
const session = flag('--session');
const quiet = args.includes('--quiet');

// A named session ignores the caller's inherited pane context.
const HERDR_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'herdr');
const SOCKET = session
  ? path.join(HERDR_DIR, 'sessions', session, 'herdr.sock')
  : process.env.HERDR_SOCKET_PATH || path.join(HERDR_DIR, 'herdr.sock');
const PIPE = process.platform === 'win32' ? `\\\\.\\pipe\\${SOCKET}` : SOCKET;

let reqId = 0;
// herdr answers one request per connection, so each call opens its own.
function call(method, params) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PIPE);
    let buf = '';
    sock.setEncoding('utf8');
    sock.setTimeout(5000, () => { sock.destroy(); reject(new Error(`${method}: timed out`)); });
    sock.on('connect', () => sock.write(JSON.stringify({ id: `eq_${++reqId}`, method, params }) + '\n'));
    sock.on('data', (chunk) => {
      buf += chunk;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      sock.end();
      const msg = JSON.parse(buf.slice(0, i));
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    });
    sock.on('error', (e) => reject(new Error(`can't reach herdr (${e.message})`)));
  });
}

// Which tab to act on: explicit flag, the plugin's focused tab, the calling pane, or the focused pane.
function target() {
  if (flag('--tab')) return { tab_id: flag('--tab') };
  if (session) return {};
  try {
    const ctx = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || '{}');
    if (ctx.tab_id) return { tab_id: ctx.tab_id };
  } catch { /* fall through */ }
  if (process.env.HERDR_TAB_ID) return { tab_id: process.env.HERDR_TAB_ID };
  return {};
}

// How many panes sit side by side along a split direction inside a node.
function span(node, dir) {
  if (node.type === 'pane') return 1;
  const a = span(node.first, dir);
  const b = span(node.second, dir);
  return node.direction === dir ? a + b : Math.max(a, b);
}

// Every split gets the ratio that gives each pane along its axis the same share.
async function even(tab) {
  const { layout } = await call('layout.export', tab);
  const sets = [];
  (function walk(node, p) {
    if (node.type !== 'split') return;
    const a = span(node.first, node.direction);
    const b = span(node.second, node.direction);
    sets.push({ path: p, ratio: a / (a + b) });
    walk(node.first, [...p, false]);
    walk(node.second, [...p, true]);
  })(layout.root, []);
  for (const s of sets) {
    await call('layout.set_split_ratio', { tab_id: layout.tab_id, path: s.path, ratio: s.ratio });
  }
  return layout;
}

// Pane counts per row. --cols fills rows to that width (6 panes, 5 cols -> 5, 1);
// otherwise rows are as even as possible (7 panes in 3 rows -> 3, 2, 2).
function rowSizes(n, width, height) {
  const clamp = (v) => Math.min(n, Math.max(1, Math.floor(Number(v)) || 1));
  if (flag('--cols')) {
    const cols = clamp(flag('--cols'));
    return Array.from({ length: Math.ceil(n / cols) }, (_, r) => Math.min(cols, n - r * cols));
  }
  const rows = flag('--rows') ? clamp(flag('--rows')) : bestRows(n, width, height);
  return Array.from({ length: rows }, (_, r) => Math.floor(n / rows) + (r < n % rows ? 1 : 0));
}

// Pick the row count whose cells are closest to square. Terminal cells are about
// twice as tall as wide, so height counts double.
function bestRows(n, width, height) {
  let best = 1;
  let bestScore = Infinity;
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows);
    const score = Math.abs(Math.log((width / cols) / ((2 * height) / rows)));
    if (score < bestScore - 1e-9) { best = rows; bestScore = score; }
  }
  return best;
}

// Rebuild the tab as rows of panes, keeping reading order. herdr won't move a pane
// within its own tab, so every pane but the first is parked in a temporary tab and
// moved back next to the one before it. Moves keep each pane's id and process;
// the temporary tab closes itself once empty, and even() then sets the sizes.
async function grid(tab) {
  const panes = await paneLayout(tab);
  const tabId = panes.tab_id;
  const order = [...panes.panes].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x).map((p) => p.pane_id);
  const sizes = rowSizes(order.length, panes.area.width, panes.area.height);
  if (order.length < 2) return sizes;
  const rows = [];
  let i = 0;
  for (const size of sizes) { rows.push(order.slice(i, i + size)); i += size; }
  const move = (pane, destination) => call('pane.move', { pane_id: pane, destination, focus: false });

  const parked = await move(order[1], { type: 'new_tab', workspace_id: panes.workspace_id, label: 'equalize' });
  const parkTab = parked.move_result.pane.tab_id;
  for (const pane of order.slice(2)) {
    await move(pane, { type: 'tab', tab_id: parkTab, split: 'right', target_pane_id: order[1] });
  }
  const place = (pane, next, split) => move(pane, { type: 'tab', tab_id: tabId, split, target_pane_id: next });
  // Stack the first pane of every row, then fill each row left to right.
  for (let r = 1; r < rows.length; r++) await place(rows[r][0], rows[r - 1][0], 'down');
  for (const row of rows) {
    for (let c = 1; c < row.length; c++) await place(row[c], row[c - 1], 'right');
  }
  // Moves can shift focus; put it back where it was.
  if (panes.focused_pane_id) await call('pane.focus', { pane_id: panes.focused_pane_id }).catch(() => {});
  await even({ tab_id: tabId });
  return sizes;
}

// Pane rectangles for a tab; pane.layout takes a pane, so look one up first.
async function paneLayout(tab) {
  if (!tab.tab_id) return (await call('pane.layout', {})).layout;
  const { layout } = await call('layout.export', tab);
  return (await call('pane.layout', { pane_id: firstPane(layout.root) })).layout;
}

function firstPane(node) {
  return node.type === 'pane' ? node.pane_id : firstPane(node.first);
}

async function main() {
  const tab = target();
  let title;
  if (mode === 'grid') {
    const sizes = await grid(tab);
    title = `grid ${sizes.join(' / ')}`;
  } else {
    const layout = await even(tab);
    const n = (function count(node) { return node.type === 'pane' ? 1 : count(node.first) + count(node.second); })(layout.root);
    title = `${n} pane${n === 1 ? '' : 's'} equalized`;
  }
  console.log(title);
  if (!quiet) await call('notification.show', { title, sound: 'none' }).catch(() => {});
}

main().catch((e) => {
  console.error(`equalize: ${e.message}`);
  process.exit(1);
});
