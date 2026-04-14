# handoff

> Transfer a Claude Code session to a remote machine to continue overnight work.

You're deep into a session locally. You want to step away. `handoff` snapshots the working tree, ships your conversation transcript to a remote box, and starts `claude --resume --dangerously-skip-permissions` inside a `tmux` session so it can keep working unattended.

## How it works

```
┌─────────────────────────┐                       ┌──────────────────────────┐
│  LOCAL                  │                       │  REMOTE                  │
│                         │                       │                          │
│  Claude Code session    │                       │                          │
│  (working dirty tree)   │                       │                          │
│                         │                       │                          │
│  1. validate git+remote │                       │                          │
│  2. find session JSONL  │                       │                          │
│  3. git stash create -u │                       │                          │
│  4. branch + push  ─────┼──── handoff/<stamp> ─►│  git fetch + checkout    │
│  5. rsync transcript ───┼──── *.jsonl ─────────►│  ~/.claude/projects/...  │
│  6. ssh + tmux launch ──┼──── claude --resume ─►│  tmux: claude --resume   │
│                         │      --dangerously-   │        --dangerously-    │
│                         │      skip-permissions │        skip-permissions  │
│                         │                       │                          │
└─────────────────────────┘                       └──────────────────────────┘
```

The local working tree is **never touched** — `git stash create -u` builds a snapshot commit object out-of-band. Your branch, your index, your dirty files all stay exactly as they were.

### Step by step

1. **Validate.** Confirms `cwd` is a git working tree and has a remote configured. Aborts with an actionable error otherwise.
2. **Locate session.** Reads `CLAUDE_SESSION_ID` if set (slash commands and hooks expose it), otherwise picks the most-recently-modified `<id>.jsonl` in `~/.claude/projects/<cwd-slug>/`.
3. **Snapshot.** Runs `git stash create -u` to package tracked + untracked files into a single commit object **without** touching the working tree, index, or current branch. If the tree is clean, falls back to `HEAD`.
4. **Branch + push.** Creates `handoff/<iso-timestamp>-<short-session-id>` pointing at the snapshot and pushes it to the first git remote.
5. **Ship transcript.** Rsyncs the local JSONL to `<remote-home>/.claude/projects/<remote-slug>/<id>.jsonl`, where `<remote-slug>` is the **remote** project path with `/` → `-`. This is necessary because Claude resolves session files based on the launching CWD's slug.
6. **Launch.** SSHes in, runs `git fetch && git checkout <branch>`, kills any existing tmux session of the same name, then starts a new detached tmux session running `claude --resume <id> --dangerously-skip-permissions`.
7. **Report.** Prints the `tmux attach` command so you can peek at progress overnight.

## Install

```bash
git clone https://github.com/SaharBarak/handoff
cd handoff
npm install
npm run build
npm link   # exposes `handoff` on PATH
```

## Setup

### 1. Bootstrap the remote machine

```bash
./scripts/install-remote.sh user@host /home/user/workspace/handoff <git-clone-url>
```

The script verifies `git`, `tmux`, `claude`, and `rsync` are installed on the remote, then clones the project to the target path.

### 2. Create your config

```bash
handoff init
```

Then edit `~/.config/handoff/config.json`:

```json
{
  "defaultTarget": "overnight",
  "targets": {
    "overnight": {
      "host": "ubuntu@my-remote.example.com",
      "projectPath": "/home/ubuntu/workspace/handoff",
      "homePath": "/home/ubuntu",
      "claudeCmd": "claude",
      "tmuxSession": "handoff-overnight"
    }
  }
}
```

`homePath` is optional — it's auto-derived from the SSH user (`ubuntu` → `/home/ubuntu`, `root` → `/root`).

## Usage

From inside a Claude Code session, fire the slash command:

```
/handoff
```

Or from a terminal:

```bash
handoff                              # uses defaultTarget
handoff overnight                    # pick a named target
handoff --host me@srv --path /srv/x  # ad-hoc target, no config required
handoff --dry-run                    # plan only — no push, no launch
handoff --verbose                    # detailed step logging
handoff --session <uuid>             # override session id
```

After the handoff completes, attach to the remote tmux session:

```bash
ssh -t ubuntu@my-remote.example.com tmux attach -t handoff-overnight
```

## Architecture

```
src/
├── domain/                # pure types, branded ids, tagged-union errors,
│                          # zod config schema, slugify
├── infrastructure/        # claude-session, git-transfer, ssh-transport,
│                          # remote-launcher, logger, config-loader
├── application/           # executeHandoff orchestrator, target-resolver
└── cli/                   # commander setup
```

DDD layering with **neverthrow** `Result<T, HandoffError>` end-to-end — no exceptions cross layer boundaries. The orchestrator (`executeHandoff`) depends on a `HandoffPorts` interface so every infrastructure adapter can be substituted in tests. London-style mock-driven tests cover the orchestrator pipeline, with pure unit tests for slug logic, config parsing, and the remote bash script builder.

## Caveats

- **Slug mismatch is intentional.** Claude resolves session files via `~/.claude/projects/<cwd-slug>/<id>.jsonl`. The local slug (`-Users-you-...`) differs from the remote slug (`-home-you-...`) because `$HOME` differs. We ship the JSONL to the **remote** slug directory and launch claude from the matching cwd, so `--resume` finds it.
- **Conversation paths are not rewritten.** Messages inside the JSONL still reference your local file paths. The model handles this fine, but it can look odd if you attach later.
- **Requires a git remote.** The handoff branch is pushed via the first git remote; the remote machine must be able to fetch it.
- **Empty repos are rejected.** Make at least one commit before running `handoff`.

## Development

```bash
npm test          # vitest — 23 tests across 5 suites
npm run typecheck # tsc --noEmit, strict mode
npm run lint      # eslint with @typescript-eslint
npm run build     # tsc → dist/
```

## License

MIT — see [LICENSE](LICENSE).
