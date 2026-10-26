// Shared animation frames for sidebar-fx.js and the config generator.
// Every frame string must be distinct per token so config rules can color each one.
'use strict';

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Glitch frames briefly replace the activity label; each starts with a block
// glyph so a single starts_with rule colors the whole family.
const GLITCH = ['▓ w0rk!ng', '░ W0RK1NG', '▒ w#rk_ng', '▓ ▚▞▚▞▚▞▚', '░ wo/rk1ng', '▒ ERR:RUN'];

// herdr indents a card's first row by 1 column and the row is (sidebar width
// - 1) wide, so with the sidebar pinned the charge bar fills to the right edge
// exactly. Longer values would be cut off with "…".
const SIDEBAR_WIDTH = 36;
const FIRST_ROW_WIDTH = SIDEBAR_WIDTH - 2;

// Charge bar: the filled stretch is a wire carrying a slow sine wave toward an
// energy-ball head. The head glyph decides the color (config uses `contains`
// rules), so the wire must never use them.
const CHARGE_HEADS = ['✦', '✧'];      // slow breath, electric -> pale cyan
const CHARGE_HOT_HEADS = ['✸', '✹'];  // nearly full
const CHARGE_STILL_HEAD = '◆';        // nothing running; no rule, so it stays gray
const CHARGE_HOT_AT = 0.85;
const BREATH_TICKS = 12;              // ticks per head color (~1.4s)

// The wave is drawn in braille: each cell is 2 dot columns x 4 dot rows.
const WAVE_PERIOD = 20;               // dot columns per wavelength (10 cells)
const WAVE_SPEED = 0.5;               // dot columns per tick, flowing toward the head
const DOT = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]];
const FLAT_WIRE = '⠒';                // still wire on the wave's middle line

const waveRow = (x, t) => Math.round(1.5 - 1.5 * Math.sin((2 * Math.PI * (x - t * WAVE_SPEED)) / WAVE_PERIOD));

// One cell of the filled wire; each dot is joined vertically to the previous
// one so the line never breaks.
function wire(i, t, live) {
  if (!live) return FLAT_WIRE;
  let bits = 0;
  for (let c = 0; c < 2; c++) {
    const x = i * 2 + c;
    const y = waveRow(x, t);
    const prev = waveRow(x - 1, t);
    for (let r = Math.min(y, prev); r <= Math.max(y, prev); r++) bits |= DOT[c][r];
  }
  return String.fromCharCode(0x2800 + bits);
}

function charge(fraction, t, live) {
  const f = Math.max(0, Math.min(1, fraction));
  const pct = ` ${Math.round(f * 100)}%`;
  const width = FIRST_ROW_WIDTH - 1 - [...pct].length; // 1 for the plug
  const filled = Math.round(f * (width - 1));
  const heads = f >= CHARGE_HOT_AT ? CHARGE_HOT_HEADS : CHARGE_HEADS;
  const head = live ? heads[Math.floor(t / BREATH_TICKS) % heads.length] : CHARGE_STILL_HEAD;
  let bar = '⌁';
  for (let i = 0; i < filled; i++) bar += wire(i, t, live);
  bar += head + '·'.repeat(width - 1 - filled);
  return bar + pct;
}

// Plan bar: the same wire, with a node per step. Finished steps are filled
// nodes, the energy ball sits on the step in progress, upcoming steps are
// hollow, and the wave flows along the finished stretch.
const PLAN_DONE_NODE = '◆';
const PLAN_TODO_NODE = '◇';
const PLAN_COMPLETE = '✓';
const PLAN_STILL_HEAD = '◈'; // nothing running; distinct from finished nodes

function planBar(done, total, t, live) {
  const label = ` ${done}/${total}`;
  const width = FIRST_ROW_WIDTH - 1 - [...label].length; // 1 for the plug
  const nodes = [...Array(total).keys()].map((k) => Math.round(((k + 1) * (width - 1)) / total));
  const complete = done >= total;
  const headAt = complete ? width - 1 : nodes[done];
  const head = complete ? PLAN_COMPLETE : live ? CHARGE_HEADS[Math.floor(t / BREATH_TICKS) % CHARGE_HEADS.length] : PLAN_STILL_HEAD;
  let bar = '⌁';
  for (let i = 0; i < width; i++) {
    const node = nodes.indexOf(i);
    if (i === headAt) bar += head;
    else if (node >= 0) bar += i < headAt ? PLAN_DONE_NODE : PLAN_TODO_NODE;
    else if (i > headAt) bar += '·';
    else bar += wire(i, t, live);
  }
  return bar + label;
}

module.exports = {
  SPIN, GLITCH, SIDEBAR_WIDTH, FIRST_ROW_WIDTH,
  CHARGE_HEADS, CHARGE_HOT_HEADS, PLAN_COMPLETE, charge, planBar,
};

