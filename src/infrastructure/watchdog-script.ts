/**
 * Self-contained bash watchdog that tails per-session log files and posts pattern matches
 * to a Telegram chat via plain curl. No Claude involved — this is a pure log → notification
 * pipe so the user gets push alerts even when the orchestrator isn't being actively prompted.
 *
 * Cross-platform `stat` (linux + macOS), bash 4 associative arrays for file offsets, ANSI
 * stripping, and rate-limited via the configured poll interval.
 *
 * The script is written to <secretsFile-dir>/handoff-watchdog.sh on the remote at handoff
 * time so it stays versioned with the CLI but doesn't require a separate package install.
 */

export const WATCHDOG_SCRIPT = `#!/usr/bin/env bash
set -uo pipefail

LOG_DIR="\${HANDOFF_LOG_DIR:?HANDOFF_LOG_DIR required}"
TOKEN="\${HANDOFF_TG_TOKEN:?HANDOFF_TG_TOKEN required}"
CHAT_ID="\${HANDOFF_TG_CHAT_ID:?HANDOFF_TG_CHAT_ID required}"
POLL="\${HANDOFF_WATCH_POLL:-30}"
PATTERNS_RE="\${HANDOFF_WATCH_PATTERNS:-ERROR|Failed|FAIL|✗|Traceback}"
STATE_DIR="\${LOG_DIR}/.watchdog"
mkdir -p "\$STATE_DIR"

send() {
  local text="\$1"
  curl -sS -X POST "https://api.telegram.org/bot\${TOKEN}/sendMessage" \\
    --data-urlencode "chat_id=\${CHAT_ID}" \\
    --data-urlencode "text=\${text}" \\
    --data-urlencode "parse_mode=Markdown" \\
    --max-time 10 \\
    >/dev/null 2>&1 || echo "watchdog: telegram send failed" >&2
}

file_size() {
  stat -c%s "\$1" 2>/dev/null || stat -f%z "\$1" 2>/dev/null || echo 0
}

strip_ansi() {
  sed -E 's/\\x1b\\[[0-9;?]*[a-zA-Z]//g'
}

declare -A POSITIONS
send "🟢 *handoff watchdog* started on \$(hostname), watching \\\`\${LOG_DIR}\\\`"

while true; do
  shopt -s nullglob
  for log in "\$LOG_DIR"/*.log; do
    name=\$(basename "\$log" .log)
    pos_file="\${STATE_DIR}/\${name}.pos"
    last="\${POSITIONS[\$name]:-\$(cat "\$pos_file" 2>/dev/null || echo 0)}"
    cur=\$(file_size "\$log")
    if [[ "\$cur" -gt "\$last" ]]; then
      delta=\$(tail -c "+\$((last + 1))" "\$log" | strip_ansi)
      hits=\$(printf '%s\\n' "\$delta" | grep -E "\$PATTERNS_RE" | head -10 || true)
      if [[ -n "\$hits" ]]; then
        send "*\${name}*"\$'\\n'"\\\`\\\`\\\`"\$'\\n'"\$hits"\$'\\n'"\\\`\\\`\\\`"
      fi
      POSITIONS["\$name"]="\$cur"
      printf '%s' "\$cur" > "\$pos_file"
    fi
  done
  sleep "\$POLL"
done
`;
