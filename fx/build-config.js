// Generates herdr's config.toml with per-frame color rules for sidebar-fx.js.
// Usage: node build-config.js <path to herdr config.toml>
const fs = require('fs');
const { EMPTY } = require('./spaces');
const { SPIN, GLITCH, SIDEBAR_WIDTH, SCAN_KEYS, SCAN_COLORS, ACCENT, ALERT } = require('./frames');

const NEON = ['#9D7CD8', '#BB9AF7', '#C792EA', '#E27AF0', '#FF79C6', '#FF2A6D', '#F7768E', '#E27AF0', '#BB9AF7', '#7DCFFF'];
// One color per glitch prefix glyph.
const GLITCH_COLORS = { '▓': '#FCEE0A', '░': '#FF2A6D', '▒': '#00F0FF' };
// Activity bar: one color per working run (matched by its invisible key, SCAN_COLORS
// in frames.js), flashing cross when blocked. sidebar-fx.js swaps `accent` to the
// focused agent's bar color.
const ALERT_COLORS = ['#FF007C', '#7A2D5A'];
// Base color for anything without a rule, e.g. the still idle bar and label.
const IDLE = '#3B4261';

if (GLITCH.some((g) => !GLITCH_COLORS[g[0]])) throw new Error('glitch frame without a color');
if (SCAN_KEYS.length !== SCAN_COLORS.length) throw new Error('scan cross without a color');

const fxRules = [
  ...SPIN.map((g, i) => `{ starts_with = "${g} ", fg = "${NEON[i]}", bold = true }`),
  ...Object.entries(GLITCH_COLORS).map(([g, c]) => `{ starts_with = "${g}", fg = "${c}", bold = true }`),
  '{ equals = "◉ needs you", fg = "#FF007C", bold = true }',
  '{ equals = "○ needs you", fg = "#7A2D5A" }',
  '{ equals = "✓ done", fg = "#73DACA", bold = true }',
];
if (fxRules.length > 16) throw new Error(`herdr allows 16 rules per token, got ${fxRules.length}`);
const fx = `{ token = "$fx", fg = "${IDLE}", rules = [ ${fxRules.join(', ')} ] }`;
// Invisible characters are written as \uXXXX escapes so config.toml stays readable.
const tomlEscape = (k) => [...k].map((c) => `\\u${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join('');
const barRules = [
  ...SCAN_KEYS.map((k, i) => `{ contains = "${tomlEscape(k)}", fg = "${SCAN_COLORS[i]}", bold = true }`),
  ...ALERT.map((g, i) => `{ contains = "${g}", fg = "${ALERT_COLORS[i]}", bold = ${i === 0} }`),
].join(', ');
const activityBar = `{ token = "$charge", fg = "${IDLE}", rules = [ ${barRules} ] }`;
// Popup commands run through cmd.exe on Windows and sh elsewhere.
const RECAP_COMMAND = process.platform === 'win32'
  ? 'node "%APPDATA%\\herdr\\fx\\recap.js" --popup'
  : 'node "$HOME/.config/herdr/fx/recap.js" --popup';

const config = `onboarding = false

# ── late-night neon · gothic scanner ──────────────────────────────────────
[theme]
name = "tokyo-night"
auto_switch = false

[theme.custom]
accent = "${ACCENT}"
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
accent = "${ACCENT}"

# Floating, card-like panes
pane_borders = "always"
pane_outer_borders = true
pane_gaps = true
pane_scrollbars = false

# Pinned so the activity bar fills its row exactly (see frames.js).
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

# Animated tokens ($charge, $fx) and session stats are streamed by fx/sidebar-fx.js.
[ui.sidebar.agents]
row_gap = 1
rows = [
  [${activityBar}],
  ["state_icon", { token = "$title", fg = "#C0CAF5", bold = true }],
  [{ token = "agent", fg = "#BB9AF7" }, { token = "$model", fg = "#565F89" }, ${fx}],
  [{ token = "$ctx", fg = "#7DCFFF" }, { token = "$out", fg = "#FF9E64" }, { token = "$age", fg = "#9ECE6A" }],
  [{ token = "$turns", fg = "#BB9AF7" }, { token = "$tools", fg = "#FF79C6" }, { token = "$subs", fg = "#00F0FF" }],
  [{ token = "workspace", fg = "#565F89" }, { token = "tab", fg = "#565F89" }],
]

# A few plain lines from fx/spaces.js; the last two show only when they matter.
[ui.sidebar.spaces]
row_gap = 1
rows = [
  ["state_icon", { token = "workspace", fg = "#C0CAF5", bold = true }, ${fx}],
  [{ token = "$now", fg = "#A9B1D6", rules = [{ contains = "need", fg = "#FF007C", bold = true }, { equals = "all quiet", fg = "#565F89" }] }],
  [{ token = "$unsaved", fg = "#E0AF68", rules = [{ equals = "${EMPTY}", hide = true }] }],
  [{ token = "$down", fg = "#FF007C", bold = true, rules = [{ equals = "${EMPTY}", hide = true }] }],
  [{ token = "branch", fg = "#7DCFFF" }, "git_status"],
]

[ui.toast]
delivery = "herdr"

[ui.sound]
enabled = false

[keys]
focus_agent = "alt+1..9"
next_agent = "prefix+a"
previous_agent = "prefix+shift+a"

# Agent recap: live state, 24h timeline and runs (fx/recap.js).
[[keys.command]]
key = "prefix+t"
type = "popup"
command = '${RECAP_COMMAND}'
width = "90%"
height = "85%"

# Equalize panes (fx/equalize, the joe.equalize plugin).
[[keys.command]]
key = "prefix+shift+e"
type = "plugin_action"
command = "joe.equalize.grid"
description = "equalize panes (grid)"

[[keys.command]]
key = "prefix+alt+e"
type = "plugin_action"
command = "joe.equalize.even"
description = "equalize panes (keep arrangement)"
`;

fs.writeFileSync(process.argv[2], config);
console.log(`wrote ${process.argv[2]} (${fxRules.length} fx rules)`);
