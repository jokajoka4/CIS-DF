#!/bin/bash
# Double-click this file in Finder to start the CIS-DF exam simulator.
# It opens your browser automatically. Close this window to stop the app.
cd "$(dirname "$0")" || exit 1
# Finder does not load your shell profile, so add the usual Node install locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click this file again."
  read -r -p "Press Enter to close..."
  exit 1
fi
OPEN_BROWSER=1 npm start
read -r -p "The app has stopped. Press Enter to close..."
