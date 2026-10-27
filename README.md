# herdr-nightcity

A late-night, rain-in-the-cyber-city look for [herdr](https://herdr.dev), the terminal workspace manager for AI coding agents. It adds a Tokyo Night base pushed toward violet and neon pink, plus an animated sidebar that shows at a glance what every agent is doing.

```
†───────█▓▒░──────────────────────†    ← activity bar: a scanner sweeps while the agent works
● Refactor the auth middleware
  claude · opus 5.5 · ⠹ ⚙ Bash          ← live activity: thinking / ⚙ tool name / writing
  ◔ 280k ctx · ↑ 61k out · ◷ 1h12m
  ↳ 16 prompts · ⚒ 171 tools
  api · 1
```

## Features

- **Activity bar.** The top row of each agent card is a gothic scanner:
  - A block sweeps between two daggers while the agent works.
  - A cross flashes when it needs you.
  - The rail lies still and gray when it's idle.
  - Each run gets its own color, and a pane keeps its color until it starts a new run after resting. Colors are saved, so a restart doesn't repaint every bar.
- **Focus follows color.** herdr's accent (the focused pane's border) changes to the focused agent's bar color. While that agent works, its border label shows a slow marker (`† claude ··◆···· †`), or `✠ claude · needs you ✠` when it's blocked.
- **Activity label.** The label shows a colored spinner with `thinking`, `⚙ <tool name>` or `writing`. Now and then it glitches for a split second (`▓ w0rk!ng`, `▒ ERR:RUN`).
- **Session stats.** The card lists the context used, output tokens, session age, prompt count and tool-call count.
- **Hermes Agent cards.** Panes running Hermes Agent get the same stats from Hermes's own session store, plus a count of its live subagents (`⑂ 1/3 subs`).
- **Title.** The card title is the pane's name if you've renamed it (prefix + Shift + P), otherwise the agent's session title.
- **Still means idle.** When nothing is running, everything freezes and turns gray, so anything that moves is working.
- **Spaces panel.** Each space shows a few plain lines, and each line appears only when it matters:
  - `3 agents working`, `1 agent needs you` or `all quiet`
  - `2 projects have unsaved work`, for repos you list in `spaces.json`
  - `ollama is down`, for local services you list in `spaces.json`
- **Recap popup.** prefix + T shows what every agent is doing now, a 24-hour timeline and recent runs. It reads an activity log the animator keeps (`<herdr config>/activity.jsonl`, trimmed to 7 days).
- **Agent keys.** Alt + 1..9 jumps to an agent, prefix + A and prefix + Shift + A step through them.
- **Equalize panes.** A herdr plugin that makes every pane in a tab the same size:
  - prefix + Shift + E rearranges the tab into an even grid sized to the pane count.
  - prefix + Alt + E keeps the arrangement and evens out the rows and columns.
  - From a shell: `node <herdr config>/fx/equalize/equalize.js grid --cols 3`.
- **Subagent windows.** When Claude starts a subagent, a pane opens in a `⑂ subagents` tab next to it:
  - It shows each step live (`⚒ Read src/app.js`), the agent's messages and its final report, and gets its own sidebar card.
  - Right-click it for a menu: copy the report or whole log, open the transcript, show details, jump to the parent agent, keep the window, or close windows.
  - When new subagents start, finished windows close. Running windows and ones you chose to keep stay open, and at most 4 are open at once.
- **Tab bar.** It reads `⚡ NC-2077 ▸ 夜の街 ░ hostname ░ time`.
- **Windows Terminal.** An optional matching "Neon Rain" color scheme.

## Requirements

- **herdr:** built and tested on 0.9.x on Windows. It should work on macOS and Linux too, but that hasn't been tested.
- **Node.js** 18 or newer.
- **A font with braille and box-drawing characters.** Cascadia Code, JetBrains Mono and most Nerd Fonts work.
- **Claude Code** (or Hermes Agent) is needed for the stats and activity labels. Other agents still get the theme, activity bar and status.

## Install

> **Heads up:** this replaces your herdr `config.toml`, including any custom keybindings. The installer backs it up first (`config.toml.bak-<timestamp>`), so you can copy your own settings back into the generated file.

**Windows** (PowerShell):

```powershell
git clone https://github.com/Stormxftw/herdr-nightcity
cd herdr-nightcity
./install.ps1             # add -Autostart to start the animator at login
```

**macOS / Linux:**

```sh
git clone https://github.com/Stormxftw/herdr-nightcity
cd herdr-nightcity
./install.sh
```

### Spaces lines (optional)

Copy `fx/spaces.example.json` to `spaces.json` in your herdr `fx` folder and list your own repos and local services. Without it, those two lines stay hidden.

### Subagent windows (optional)

Add two hooks to `~/.claude/settings.json` so Claude Code tells herdr about subagents. Merge them with any hooks you already have, and use your own herdr config path (`~/.config/herdr` on macOS and Linux):

```json
"hooks": {
  "SubagentStart": [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/<you>/AppData/Roaming/herdr/fx/subagents.js\" start", "async": true }] }],
  "SubagentStop":  [{ "hooks": [{ "type": "command", "command": "node \"C:/Users/<you>/AppData/Roaming/herdr/fx/subagents.js\" stop", "async": true }] }]
}
```

The hooks do nothing outside herdr. Copying to the clipboard and opening the transcript from the menu work on Windows only.

After a reboot, start the animator again with:
- **Windows:** double-click `%APPDATA%\herdr\fx\start-sidebar-fx.vbs`, or install with `-Autostart`.
- **macOS / Linux:** run `node ~/.config/herdr/fx/sidebar-fx.js &`.

## How it works

herdr can't animate anything by itself, but it does let a script fill in values for sidebar rows, and it can color a value based on its exact text. So:

- **`fx/sidebar-fx.js`** runs in the background:
  - It polls herdr's local socket API and tails each Claude Code transcript (`~/.claude/projects/**/<session>.jsonl`).
  - About 8 times a second, it sends the current animation frame to herdr. Frames expire after 1.5s, so if the script stops, the animation disappears instead of freezing.
- **`fx/frames.js`** holds every animation frame. herdr colors a value only by its text, so each bar color is keyed by an invisible variation selector after the dagger. The bars look the same and only the color changes.
- **`fx/build-config.js`** generates `config.toml`, with color rules built from those same frames so they can't drift apart. herdr has one accent color, so `sidebar-fx.js` rewrites it in `config.toml` and reloads the config when focus moves.
- **`fx/hermes.js`** reads Hermes Agent's session store (`state.db`, read-only) and matches live sessions to Hermes panes.
- **`fx/spaces.js`** builds the Spaces lines. It checks the listed repos every minute and the listed services every 10 seconds.
- **`fx/activity.js`** and **`fx/recap.js`** keep the activity log and draw the recap popup.
- **`fx/equalize/`** is a herdr plugin. The installer links it with `herdr plugin link`.
- **`fx/subagents.js`** is the Claude Code hook. It keeps one tab per parent session and one pane per subagent, and records them in `<herdr config>/subagents/<session>.json`.
- **`fx/subagent-view.js`** runs in each of those panes:
  - It follows the subagent's transcript (`~/.claude/projects/**/<session>/subagents/agent-<id>.jsonl`).
  - It strips escape sequences and control characters before drawing, because transcripts hold tool output and file contents.
  - The pane receives right-clicks (`pane input --right-click pane`), so the viewer draws its own menu. Right-click the pane's border for herdr's usual menu.

## Customize

- **Bar colors:** `SCAN_COLORS` and `ACCENT` in `fx/frames.js`. Keep one entry in `SCAN_KEYS` per color.
- **Other colors:** the palettes at the top of `fx/build-config.js` (`NEON`, `GLITCH_COLORS`, `ALERT_COLORS`) and the theme block below them.
- **Sidebar width:** `SIDEBAR_WIDTH` in `fx/frames.js`. The bar is sized to exactly fill a pinned-width sidebar.
- **Spaces lines:** your `spaces.json` (see `fx/spaces.example.json`).

After changing anything, run the installer again. Or rebuild by hand with `node fx/build-config.js <path to config.toml>`, then run `herdr server reload-config` and restart the animator.

## Limits

- herdr allows 16 color rules per value, and the activity label uses all 16.
- Activity comes from the agent's transcript, so it can lag a second or two behind.
- Following focus rewrites `accent` in `config.toml`, so edit colors in `fx/frames.js`, not in `config.toml`.

## Uninstall

1. Restore your backup over `config.toml`, then run `herdr server reload-config`.
2. Stop the animator:
   - Windows: end the `node.exe` process whose command line includes `sidebar-fx`.
   - macOS / Linux: `pkill -f sidebar-fx.js`.
3. Remove the `SubagentStart` and `SubagentStop` hooks from `~/.claude/settings.json`, if you added them.
4. Run `herdr plugin unlink joe.equalize`.
5. Delete the `fx` and `subagents` folders, `activity.jsonl` and `bar-colors.json` in your herdr config directory.
6. On Windows, also delete:
   - the Startup shortcut `herdr sidebar-fx.lnk`, if you used `-Autostart`
   - `%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\herdr-nightcity`

## License

MIT
