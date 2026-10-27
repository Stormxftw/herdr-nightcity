#!/usr/bin/env sh
# Installs herdr-nightcity on macOS/Linux: the neon theme and animated sidebar.
#   ./install.sh            install, reload herdr, start the animator
#   ./install.sh --no-start install files only
set -eu

command -v node >/dev/null 2>&1 || { echo "Node.js is required (https://nodejs.org)." >&2; exit 1; }

here=$(cd "$(dirname "$0")" && pwd)
herdr_dir="${XDG_CONFIG_HOME:-$HOME/.config}/herdr"
config="${HERDR_CONFIG_PATH:-$herdr_dir/config.toml}"
fx_dir="$herdr_dir/fx"

mkdir -p "$fx_dir"
cp -R "$here"/fx/. "$fx_dir"/
echo "Copied animator to $fx_dir"

if command -v herdr >/dev/null 2>&1; then
  herdr plugin link "$fx_dir/equalize" >/dev/null && echo "Linked the equalize panes plugin"
fi

if [ -f "$config" ]; then
  backup="$config.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$config" "$backup"
  echo "Backed up your config to $backup"
fi
node "$fx_dir/build-config.js" "$config"

if [ "${1:-}" != "--no-start" ]; then
  if command -v herdr >/dev/null 2>&1; then
    herdr server reload-config >/dev/null && echo "Reloaded herdr"
  fi
  pkill -f 'herdr/fx/sidebar-fx.js' 2>/dev/null || true
  nohup node "$fx_dir/sidebar-fx.js" >/dev/null 2>&1 &
  echo "Started the sidebar animator (pid $!)"
fi
