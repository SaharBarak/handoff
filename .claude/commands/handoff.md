---
description: Hand off this Claude session to a remote machine to continue overnight work
argument-hint: "[target] [--dry-run]"
allowed-tools: Bash
---

Transfer the current Claude Code session to a configured remote machine. The
remote will resume the conversation under tmux with `--dangerously-skip-permissions`,
so it can keep working unattended.

Steps the command performs (already automated by the CLI):

1. Validates the working tree is a git repo with a remote configured
2. Snapshots tracked + untracked changes into a `handoff/<timestamp>-<sid>` branch via `git stash create -u` (working tree untouched)
3. Pushes the handoff branch
4. Rsyncs the session JSONL to `~/.claude/projects/<remote-slug>/` on the remote
5. SSHes in, checks out the branch, launches `claude --resume <id> --dangerously-skip-permissions` inside a detached tmux session
6. Prints the `tmux attach` command for follow-along

Run it now with the user-supplied arguments:

!`cd "$CLAUDE_PROJECT_DIR" && handoff $ARGUMENTS`

If `handoff` is not on PATH yet, run from the repo:

!`cd "$CLAUDE_PROJECT_DIR" && node ./dist/index.js $ARGUMENTS`
