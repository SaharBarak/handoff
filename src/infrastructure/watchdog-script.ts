/**
 * Self-contained bash watchdog. Tails per-session log files, pattern-matches errors, and
 * posts hits to a Telegram chat via plain curl. No Claude involvement — a pure log →
 * notification pipe so the user gets push alerts even when the orchestrator isn't being
 * actively prompted.
 *
 * Hardening (OpenClaw review, PR #1):
 *   1. MAX_CHARS truncation — Telegram rejects messages > 4096 chars. We cap at 3800 to
 *      leave headroom for the <pre> wrapper and an ellipsis marker.
 *   2. HTML parse mode with entity escaping — Markdown mode silently breaks on stray
 *      backticks / underscores inside captured log output. HTML needs only <, >, &
 *      escaped and <pre> blocks render cleanly.
 *   3. Rate limit — min 2s between sends via a file timestamp, so a flood of 20
 *      simultaneous errors doesn't hit Telegram's per-chat 1/sec cap.
 *   4. Stale offset reaping — if a log file was truncated or recreated (cur < last),
 *      reset the offset to 0. If the log file no longer exists, delete the .pos file.
 *
 * Cross-platform: Linux (stat -c%s) and macOS (stat -f%z). Requires bash 4+ for
 * associative arrays; Hetzner Ubuntu ships bash 5.
 *
 * Written to <homePath>/.local/bin/handoff-watchdog.sh on the remote at handoff time via
 * heredoc, so it's versioned with the CLI but doesn't need a separate package install.
 */

export const WATCHDOG_SCRIPT = `#!/usr/bin/env bash
set -uo pipefail

LOG_DIR="\${HANDOFF_LOG_DIR:?HANDOFF_LOG_DIR required}"
TOKEN="\${HANDOFF_TG_TOKEN:?HANDOFF_TG_TOKEN required}"
CHAT_ID="\${HANDOFF_TG_CHAT_ID:?HANDOFF_TG_CHAT_ID required}"
POLL="\${HANDOFF_WATCH_POLL:-30}"
PATTERNS_RE="\${HANDOFF_WATCH_PATTERNS:-ERROR|Failed|FAIL|✗|Traceback}"
MIN_SEND_GAP="\${HANDOFF_MIN_SEND_GAP:-2}"
MAX_CHARS=3800
STATE_DIR="\${LOG_DIR}/.watchdog"
LAST_SENT_FILE="\${STATE_DIR}/.last_sent"
mkdir -p "\$STATE_DIR"

html_escape() {
  sed -e 's/&/\\&amp;/g' -e 's/</\\&lt;/g' -e 's/>/\\&gt;/g'
}

truncate_body() {
  local text="\$1"
  local len=\${#text}
  if (( len > MAX_CHARS )); then
    printf '%s\\n[...truncated %d chars]' "\${text:0:MAX_CHARS}" \$(( len - MAX_CHARS ))
  else
    printf '%s' "\$text"
  fi
}

rate_limit() {
  local now last diff
  now=\$(date +%s)
  last=\$(cat "\$LAST_SENT_FILE" 2>/dev/null || echo 0)
  diff=\$(( now - last ))
  if (( diff < MIN_SEND_GAP )); then
    sleep \$(( MIN_SEND_GAP - diff ))
  fi
  date +%s > "\$LAST_SENT_FILE"
}

send() {
  local text="\$1"
  rate_limit
  curl -sS -X POST "https://api.telegram.org/bot\${TOKEN}/sendMessage" \\
    --data-urlencode "chat_id=\${CHAT_ID}" \\
    --data-urlencode "text=\${text}" \\
    --data-urlencode "parse_mode=HTML" \\
    --max-time 10 \\
    >/dev/null 2>&1 || echo "watchdog: telegram send failed" >&2
}

file_size() {
  stat -c%s "\$1" 2>/dev/null || stat -f%z "\$1" 2>/dev/null || echo 0
}

strip_ansi() {
  sed -E 's/\\x1b\\[[0-9;?]*[a-zA-Z]//g'
}

reap_stale_offsets() {
  shopt -s nullglob
  local pos name
  for pos in "\$STATE_DIR"/*.pos; do
    name=\$(basename "\$pos" .pos)
    if [[ ! -f "\$LOG_DIR/\$name.log" ]]; then
      rm -f "\$pos"
    fi
  done
}

declare -A POSITIONS
send "🟢 <b>handoff watchdog</b> started on \$(hostname | html_escape), watching <code>\$(printf '%s' "\$LOG_DIR" | html_escape)</code>"

while true; do
  reap_stale_offsets
  shopt -s nullglob
  for log in "\$LOG_DIR"/*.log; do
    name=\$(basename "\$log" .log)
    pos_file="\${STATE_DIR}/\${name}.pos"
    last="\${POSITIONS[\$name]:-\$(cat "\$pos_file" 2>/dev/null || echo 0)}"
    cur=\$(file_size "\$log")
    # Truncation / rotation: file is shorter than stored offset → reset to start.
    if (( cur < last )); then
      last=0
    fi
    if (( cur > last )); then
      delta=\$(tail -c "+\$(( last + 1 ))" "\$log" | strip_ansi)
      hits=\$(printf '%s\\n' "\$delta" | grep -E "\$PATTERNS_RE" | head -20 || true)
      if [[ -n "\$hits" ]]; then
        escaped=\$(printf '%s' "\$hits" | html_escape)
        name_escaped=\$(printf '%s' "\$name" | html_escape)
        body=\$(printf '<b>%s</b>\\n<pre>%s</pre>' "\$name_escaped" "\$(truncate_body "\$escaped")")
        send "\$body"
      fi
      POSITIONS["\$name"]="\$cur"
      printf '%s' "\$cur" > "\$pos_file"
    fi
  done
  sleep "\$POLL"
done
`;
