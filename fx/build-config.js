// Generates herdr's config.toml with per-frame color rules for sidebar-fx.js.
// Usage: node build-config.js <path to herdr config.toml>
const fs = require('fs');
const { SPIN, GLITCH, SIDEBAR_WIDTH, CHARGE_HEADS, CHARGE_HOT_HEADS, PLAN_COMPLETE } = require('./frames');

const NEON = ['#9D7CD8', '#BB9AF7', '#C792EA', '#E27AF0', '#FF79C6', '#FF2A6D', '#F7768E', '#E27AF0', '#BB9AF7', '#7DCFFF'];
// One color per glitch prefix glyph.
const GLITCH_COLORS = { '▓': '#FCEE0A', '░': '#FF2A6D', '▒': '#00F0FF' };
// Energy-ball head colors for the charge bar; hot heads mean nearly full.
const CHARGE_COLORS = ['#00F0FF', '#9FF8FF'];
const CHARGE_HOT_COLORS = ['#FF003C', '#FF9E64'];
// Base color for anything without a rule, e.g. the still idle bar and label.
const IDLE = '#3B4261';

if (GLITCH.some((g) => !GLITCH_COLORS[g[0]])) throw new Error('glitch frame without a color');

const fxRules = [
  ...SPIN.map((g, i) => `{ starts_with = "${g} ", fg = "${NEON[i]}", bold = true }`),
  ...Object.entries(GLITCH_COLORS).map(([g, c]) => `{ starts_with = "${g}", fg = "${c}", bold = true }`),
  '{ equals = "◉ needs you", fg = "#FF007C", bold = true }',
  '{ equals = "○ needs you", fg = "#7A2D5A" }',
  '{ equals = "✓ done", fg = "#73DACA", bold = true }',
];
if (fxRules.length > 16) throw new Error(`herdr allows 16 rules per token, got ${fxRules.length}`);
const fx = `{ token = "$fx", fg = "${IDLE}", rules = [ ${fxRules.join(', ')} ] }`;
const chargeRules = [
  ...CHARGE_HOT_HEADS.map((h, i) => `{ contains = "${h}", fg = "${CHARGE_HOT_COLORS[i]}", bold = true }`),
  ...CHARGE_HEADS.map((h, i) => `{ contains = "${h}", fg = "${CHARGE_COLORS[i]}", bold = true }`),
  `{ contains = "${PLAN_COMPLETE}", fg = "#73DACA", bold = true }`,
].join(', ');
const chargeBar = `{ token = "$charge", fg = "${IDLE}", rules = [ ${chargeRules} ] }`;

const config = `onboarding = false

# ── late-night neon · edgerunner charge ─────────────────────────────────────
[theme]
name = "tokyo-night"
auto_switch = false

[theme.custom]
accent = "#BB9AF7"
panel_bg = "reset"
sidebar_bg = "#100E1A"
active_row_bg = "#221B38"
selection_bg = "#2F2552"
green = "#73DACA"
blue = "#7AA2F7"
red = "#FF007C"
yellow = "#E0AF68"

[ui]
status_indicators = "symbols"
show_agent_labels_on_pane_borders = true
accent = "#BB9AF7"

# Floating, card-like panes
pane_borders = "always"
pane_outer_borders = true
pane_gaps = true
pane_scrollbars = false

# Pinned so the charge bar fills its row exactly (see frames.js).
sidebar_width = ${SIDEBAR_WIDTH}
sidebar_min_width = ${SIDEBAR_WIDTH}
sidebar_max_width = ${SIDEBAR_WIDTH}

tab_bar_right = [
  { type = "zoom" },
  { type = "text", text = "⚡ NC-2077 ▸ 夜の街" },
  { type = "hostname" },
  { type = "datetime", format = "%H:%M" },
]
tab_bar_right_separator = "  ░  "

window_title = "⚡ herdr ▸ {workspace}"

# Animated tokens ($charge, $step, $fx) and session stats are streamed by fx/sidebar-fx.js.
[ui.sidebar.agents]
row_gap = 1
rows = [
  [${chargeBar}],
  [{ token = "$step", fg = "#7DCFFF", rules = [{ starts_with = "✓", fg = "#73DACA" }] }],
  ["state_icon", { token = "$title", fg = "#C0CAF5", bold = true }],
  [{ token = "agent", fg = "#BB9AF7" }, { token = "$model", fg = "#565F89" }, ${fx}],
  [{ token = "$ctx", fg = "#7DCFFF" }, { token = "$out", fg = "#FF9E64" }, { token = "$age", fg = "#9ECE6A" }],
  [{ token = "$turns", fg = "#BB9AF7" }, { token = "$tools", fg = "#FF79C6" }],
  [{ token = "workspace", fg = "#565F89" }, { token = "tab", fg = "#565F89" }],
]

[ui.sidebar.spaces]
row_gap = 1
rows = [
  ["state_icon", { token = "workspace", fg = "#C0CAF5", bold = true }, ${fx}],
  [{ token = "branch", fg = "#7DCFFF" }, "git_status"],
]

[ui.toast]
delivery = "herdr"

[ui.sound]
enabled = false
`;

fs.writeFileSync(process.argv[2], config);
console.log(`wrote ${process.argv[2]} (${fxRules.length} fx rules)`);
