// Shared animation frames for sidebar-fx.js and the config generator.
// Every frame string must be distinct per token so config rules can color each one.
'use strict';

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Glitch frames briefly replace the activity label; each starts with a block
// glyph so a single starts_with rule colors the whole family.
const GLITCH = ['▓ w0rk!ng', '░ W0RK1NG', '▒ w#rk_ng', '▓ ▚▞▚▞▚▞▚', '░ wo/rk1ng', '▒ ERR:RUN'];

// herdr indents a card's first row by 1 column and the row is (sidebar width
// - 1) wide, so with the sidebar pinned the activity bar fills to the right
// edge exactly. Longer values would be cut off with "…".
const SIDEBAR_WIDTH = 36;
const FIRST_ROW_WIDTH = SIDEBAR_WIDTH - 2;

// Activity bar: a scanner sweeps back and forth between two crosses while the
// agent works, an iron cross flashes when it needs you, and the rail lies still
// otherwise. Config colors it with `contains` rules on these glyphs, so the
// rails must never use them. Each working run gets its own color from
// SCAN_COLORS.
const BAR_CAP = '†';
// Every bar shows the same dagger; each color is keyed by an invisible
// variation selector after it (VS1-VS6, which terminals draw as nothing), so
// colors don't change the bar's shape.
const SCAN_KEYS = ['︀', '︁', '︂', '︃', '︄', '︅'];
const SCAN_CAPS = SCAN_KEYS.map((k) => BAR_CAP + k);
const SCAN_COLORS = ['#FF007C', '#00F0FF', '#FCEE0A', '#BB9AF7', '#FF9E64', '#9ECE6A'];
// herdr's accent when no agent pane is focused.
const ACCENT = '#BB9AF7';
const BAR_RAIL = '─';
const BAR_STILL = '┄';
const SCAN_HEAD = '█';
const SCAN_TRAIL = ['▓', '▒', '░'];
const ALERT = ['✠', '✙'];             // bright, dim
const ALERT_TICKS = 4;                // ticks per flash (~0.5s)

function activityBar(status, t, color = 0) {
  const width = FIRST_ROW_WIDTH - 2; // 2 for the caps
  const cells = Array(width).fill(status === 'working' ? BAR_RAIL : BAR_STILL);
  if (status === 'working') {
    const period = 2 * (width - 1);
    const p = t % period;
    const x = p < width ? p : period - p;
    const dir = p < width - 1 ? 1 : -1;
    cells[x] = SCAN_HEAD;
    SCAN_TRAIL.forEach((g, k) => {
      const i = x - dir * (k + 1);
      if (i >= 0 && i < width) cells[i] = g;
    });
  } else if (status === 'blocked') {
    cells.fill('═');
    cells[Math.floor(width / 2)] = ALERT[Math.floor(t / ALERT_TICKS) % ALERT.length];
  }
  const cap = status === 'working' ? SCAN_CAPS[color % SCAN_CAPS.length] : BAR_CAP;
  return cap + cells.join('') + cap;
}

module.exports = { SPIN, GLITCH, SIDEBAR_WIDTH, FIRST_ROW_WIDTH, SCAN_KEYS, SCAN_CAPS, SCAN_COLORS, ACCENT, ALERT, activityBar };

