# herdr-nightcity

A late-night, rain-in-the-cyber-city look for [herdr](https://herdr.dev), the terminal workspace manager for AI coding agents. It adds a Tokyo Night base pushed toward violet and neon pink, plus an animated sidebar that shows at a glance what every agent is doing.

```
⌁⠦⣄⣀⣀⡤⠖⠋⠉✧···················· 28%    ← context charge: a slow wave flowing to the energy ball
● Refactor the auth middleware
  claude · opus 5.5 · ⠹ ⚙ Bash          ← live activity: thinking / ⚙ tool name / writing
  ◔ 280k ctx · ↑ 61k out · ◷ 1h12m
  ↳ 16 prompts · ⚒ 171 tools
  api · 1
```

With an approved plan, the top bar tracks the plan's steps instead:

```
⌁⠴⠚⠉⠉⠓◆⢤⣀⣀◆⠴⠚⠉⠉◆⠲⢤⣀⣀✦···◇····◇ 3/6
   ▸ Build, automated review, launcher
```

## Features

- **Charge bar.** The filled part of the bar is a slow braille sine wave rolling toward a breathing cyan energy ball. It shows how full Claude's context window is, and the ball turns red-hot above 85%.
- **Plan progress.** When Claude leaves plan mode with a numbered plan ("Phase 1 …", "Step 2 …", or a numbered list), the bar becomes one node per step:
  - `◆` marks a finished step.
  - `✦` marks the step in progress.
  - `◇` marks steps still to come.
  - The row underneath shows the current step's name.
- **Activity label.** The label shows a colored spinner with `thinking`, `⚙ <tool name>` or `writing`. Now and then it glitches for a split second (`▓ w0rk!ng`, `▒ ERR:RUN`).
- **Session stats.** The card lists the context used, output tokens, session age, prompt count and tool-call count.
- **Title.** The card title is the pane's name if you've renamed it (prefix + Shift + P), otherwise Claude's session title.
- **Still means idle.** When nothing is running, everything freezes and turns gray, so anything that moves is working.
- **Spaces panel.** Each space gets the same animated rollup.
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
- **Claude Code** is needed for the stats, plan bar and activity labels. Other agents still get the theme and status.

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
- **`fx/frames.js`** holds every animation frame.
- **`fx/build-config.js`** generates `config.toml`, with color rules built from those same frames so they can't drift apart.
- **`fx/plan.js`** finds the plan's steps and tracks progress:
  - Claude doesn't record which steps are done, so progress comes from what it says ("Phase 2 is done", "starting step 3").
  - If the plan file uses `- [x]` checkboxes, those are counted instead, and they're exact.
- **`fx/subagents.js`** is the Claude Code hook. It keeps one tab per parent session and one pane per subagent, and records them in `<herdr config>/subagents/<session>.json`.
- **`fx/subagent-view.js`** runs in each of those panes:
  - It follows the subagent's transcript (`~/.claude/projects/**/<session>/subagents/agent-<id>.jsonl`).
  - It strips escape sequences and control characters before drawing, because transcripts hold tool output and file contents.
  - The pane receives right-clicks (`pane input --right-click pane`), so the viewer draws its own menu. Right-click the pane's border for herdr's usual menu.

## Customize

- **Colors:** edit the palettes at the top of `fx/build-config.js` (`NEON`, `CHARGE_COLORS`, `GLITCH_COLORS`) and the theme block below them.
- **Wave:** `WAVE_SPEED` and `WAVE_PERIOD` in `fx/frames.js`.
- **Context window size:** set `SIDEBAR_FX_CONTEXT_LIMIT` (default `1000000` tokens).
- **Sidebar width:** `SIDEBAR_WIDTH` in `fx/frames.js`. The bar is sized to exactly fill a pinned-width sidebar.

After changing anything, run the installer again. Or rebuild by hand with `node fx/build-config.js <path to config.toml>`, then run `herdr server reload-config` and restart the animator.

## Limits

- herdr allows 16 color rules per value, and the activity label uses all 16.
- Activity and plan progress come from Claude's transcript, so they can lag a second or two behind.
- Plan progress is an estimate unless the plan uses checkboxes.

## Uninstall

1. Restore your backup over `config.toml`, then run `herdr server reload-config`.
2. Stop the animator:
   - Windows: end the `node.exe` process whose command line includes `sidebar-fx`.
   - macOS / Linux: `pkill -f sidebar-fx.js`.
3. Remove the `SubagentStart` and `SubagentStop` hooks from `~/.claude/settings.json`, if you added them.
4. Delete the `fx` and `subagents` folders in your herdr config directory.
5. On Windows, also delete:
   - the Startup shortcut `herdr sidebar-fx.lnk`, if you used `-Autostart`
   - `%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\herdr-nightcity`

## License

MIT
