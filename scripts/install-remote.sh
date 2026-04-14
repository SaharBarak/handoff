#!/usr/bin/env bash
# Bootstrap a remote machine to receive handoffs.
# Usage: ./scripts/install-remote.sh user@host /home/user/workspace/handoff <git-clone-url>

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: $0 <user@host> <remote-project-path> <git-clone-url>" >&2
  exit 1
fi

REMOTE="$1"
REMOTE_PATH="$2"
GIT_URL="$3"

ssh "$REMOTE" bash -lc "'
  set -euo pipefail

  command -v git    >/dev/null || { echo missing: git; exit 2; }
  command -v tmux   >/dev/null || { echo missing: tmux; exit 2; }
  command -v claude >/dev/null || { echo missing: claude; exit 2; }
  command -v rsync  >/dev/null || { echo missing: rsync; exit 2; }

  if [ ! -d \"$REMOTE_PATH/.git\" ]; then
    mkdir -p \"$(dirname $REMOTE_PATH)\"
    git clone \"$GIT_URL\" \"$REMOTE_PATH\"
  fi

  mkdir -p \"\$HOME/.claude/projects\"
  echo \"remote ready: $REMOTE_PATH\"
'"
