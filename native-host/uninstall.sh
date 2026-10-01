#!/bin/sh
# Removes the Ask AI account bridge.
set -eu
rm -rf "$HOME/Library/Application Support/AskAI"
rm -f "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.askai.bridge.json"
echo "Removed helper and per-user registration."
for SYS in "/Library/Application Support/Chromium/NativeMessagingHosts/com.askai.bridge.json" "/Library/Google/Chrome/NativeMessagingHosts/com.askai.bridge.json"; do
  if [ -e "$SYS" ]; then sudo rm -f "$SYS" && echo "Removed $SYS"; fi
done
