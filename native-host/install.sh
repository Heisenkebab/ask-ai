#!/bin/sh
# Installs the Ask AI account bridge for Brave.
#   ./install.sh            per-user registration (no sudo)
#   ./install.sh --system   also register system-wide (sudo), for Brave builds that ignore the per-user folder
# Re-run after updating the extension, so the installed helper is up to date.
set -eu

HOST_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(dirname "$HOST_DIR")"
# The helper is copied out of the project: macOS doesn't let Brave run programs inside
# ~/Documents, ~/Desktop or ~/Downloads (privacy protection), so it would exit immediately.
INSTALL_DIR="$HOME/Library/Application Support/AskAI"
USER_DIR="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
SYSTEM_DIRS="/Library/Application Support/Chromium/NativeMessagingHosts:/Library/Google/Chrome/NativeMessagingHosts"
NAME="com.askai.bridge"

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Error: node not found. Install Node.js first." >&2
  exit 1
fi

EXT_ID="$("$NODE" "$HOST_DIR/extension-id.mjs" "$EXT_DIR/manifest.json")"

mkdir -p "$INSTALL_DIR"
cp "$HOST_DIR/ask-ai-host.mjs" "$INSTALL_DIR/ask-ai-host.mjs"

# Launcher with the absolute node path: Brave started from the Dock doesn't have your shell PATH.
cat > "$INSTALL_DIR/ask-ai-host" <<WRAPPER
#!/bin/sh
exec "$NODE" "$INSTALL_DIR/ask-ai-host.mjs" "\$@"
WRAPPER
chmod 755 "$INSTALL_DIR/ask-ai-host"

# Host manifest: Brave starts the bridge only for this one extension ID.
mkdir -p "$USER_DIR"
"$NODE" -e '
  const [path, ext, out] = process.argv.slice(1);
  require("fs").writeFileSync(out, JSON.stringify({
    name: "com.askai.bridge",
    description: "Ask AI account bridge (runs your logged-in Claude / Antigravity / Codex CLI)",
    path,
    type: "stdio",
    allowed_origins: [`chrome-extension://${ext}/`],
  }, null, 2) + "\n");
' "$INSTALL_DIR/ask-ai-host" "$EXT_ID" "$USER_DIR/$NAME.json"

echo "Installed bridge for extension $EXT_ID"
echo "  helper:   $INSTALL_DIR/"
echo "  manifest: $USER_DIR/$NAME.json"

if [ "${1:-}" = "--system" ]; then
  IFS=:
  for SYS_DIR in $SYSTEM_DIRS; do
    sudo mkdir -p "$SYS_DIR"
    sudo cp "$USER_DIR/$NAME.json" "$SYS_DIR/$NAME.json"
    sudo chmod 644 "$SYS_DIR/$NAME.json"
    echo "  manifest: $SYS_DIR/$NAME.json"
  done
  unset IFS
fi

echo
echo "CLI status:"
"$INSTALL_DIR/ask-ai-host" --status
echo
echo "Next: quit Brave (Cmd+Q), reopen it and open the Ask AI settings."
