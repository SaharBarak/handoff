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

## Telegram orchestrator & watchdog (optional)

`handoff` can attach a Telegram-driven orchestrator and a push-notification watchdog to each handoff, so you can monitor and command your overnight sessions from your phone. It's built on top of **Anthropic's first-party Claude Code Channels** plugin (released March 2026), which means it works under your Pro/Max subscription with no separate API key and is fully sanctioned — no harness-detection risk.

### Architecture

Three tmux session types on the remote, coordinated through per-session log files:

```
Hetzner box
├── handoff-<project>           work session: claude --resume <id> --dangerously-skip-permissions
│     └── tmux pipe-pane → ~/.local/share/handoff/handoff-<project>.log
├── handoff-orchestrator        claude --resume <orch-id> --channels plugin:telegram@... (start-once-reuse)
│     └── interactive Telegram bot; inspects/commands other sessions via shell tools
└── handoff-watchdog            pure bash daemon (no claude); tails the *.log files (start-once-reuse)
      └── greps for patterns, posts matches to Telegram via curl
```

The orchestrator is a **single long-lived claude session** you create once on the remote and resume forever. It has shell access, so from Telegram you can ask it:

- *"what's everyone working on?"* → it runs `tmux list-sessions` + `tmux capture-pane` on each
- *"any errors in projectA?"* → it tails the log
- *"tell projectB to roll back the last migration"* → it runs `tmux send-keys -t handoff-projectB "..." Enter`

The watchdog is a dumb but reliable push-only layer: pattern-matching bash + `curl` to the Telegram Bot API. No LLM involvement, so it can't be rate-limited by your subscription.

### One-time setup

#### 1. Create the Telegram bot

Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → follow prompts → save the token. Then message [@userinfobot](https://t.me/userinfobot) to get your numeric `chat_id`.

#### 2. Put the secrets on the remote

SSH into the box and write a permissions-restricted env file:

```bash
ssh hetzner
mkdir -p ~/.config/handoff
cat > ~/.config/handoff/secrets.env <<'EOF'
HANDOFF_TG_TOKEN=123456:ABC-YourBotFatherToken
HANDOFF_TG_CHAT_ID=987654321
EOF
chmod 600 ~/.config/handoff/secrets.env
```

#### 3. Authenticate Claude Code Channels on the remote (one-time, interactive)

```bash
# still SSHed in
claude --channels plugin:telegram@claude-plugins-official
# paste the BotFather token when prompted
# verify on your phone by messaging the bot — it should answer
```

After this, the plugin config is cached in the remote's `~/.claude/` and subsequent non-interactive launches don't need the flag re-configured.

#### 4. Create the dedicated orchestrator session (one-time)

Still on the remote, start a fresh claude session that will *become* the orchestrator. Give it a system-level system prompt describing its role, let it acknowledge, then exit — the JSONL gets saved automatically, and you copy the session id out.

```bash
claude
# In the session, type something like:
#   "You are the handoff orchestrator. You manage all work sessions in tmux on
#    this machine. When messaged via Telegram, you can use tmux capture-pane,
#    tmux send-keys, and tail log files under ~/.local/share/handoff/ to
#    inspect and command other claude work sessions. Acknowledge and wait."
# Let claude respond, then /exit.

# Find the session id:
ls -t ~/.claude/projects/*/*.jsonl | head -1
# the filename (minus .jsonl) is the session id
```

Copy that session id into your local handoff config.

### Config

Add an `orchestrator` block and optionally a `watchdog` block to your target in `~/.config/handoff/config.json`:

```json
{
  "defaultTarget": "hetzner",
  "targets": {
    "hetzner": {
      "host": "hetzner",
      "projectPath": "/root/workspace/handoff",
      "homePath": "/root",
      "claudeCmd": "claude",
      "tmuxSession": "handoff-hetzner",
      "orchestrator": {
        "sessionId": "7f3e2a8b-....-....-....-............"
      },
      "watchdog": {
        "pollSeconds": 30,
        "patterns": ["ERROR", "Failed", "Traceback", "✓ done"]
      }
    }
  }
}
```

All orchestrator/watchdog fields except `sessionId` are optional. Defaults:

| field | default |
|---|---|
| `orchestrator.channelsPlugin` | `plugin:telegram@claude-plugins-official` |
| `orchestrator.tmuxSession` | `handoff-orchestrator` |
| `orchestrator.secretsFile` | `<homePath>/.config/handoff/secrets.env` |
| `watchdog.tmuxSession` | `handoff-watchdog` |
| `watchdog.logDir` | `<homePath>/.local/share/handoff` |
| `watchdog.pollSeconds` | `30` |
| `watchdog.patterns` | `["ERROR","Failed","FAIL","✓ done","✗","Traceback"]` |
| `watchdog.tokenEnvVar` | `HANDOFF_TG_TOKEN` |
| `watchdog.chatIdEnvVar` | `HANDOFF_TG_CHAT_ID` |

### Lifecycle

- **Work sessions** are killed and replaced on every handoff (same as before).
- **Orchestrator and watchdog use start-once-reuse**: the first handoff spins them up, subsequent handoffs to the same target leave them running. The orchestrator accumulates context about your projects over time; the watchdog keeps file-offset state in `<logDir>/.watchdog/` so it doesn't re-report old matches after a restart.
- To force a restart: `ssh hetzner tmux kill-session -t handoff-orchestrator` (or `handoff-watchdog`) — next handoff will recreate.

### Attach commands

`handoff` prints the attach command for each active tmux session at the end of a run:

```
  attach:    ssh -t hetzner tmux attach -t handoff-hetzner
  orch:      ssh -t hetzner tmux attach -t handoff-orchestrator
  watchdog:  ssh -t hetzner tmux attach -t handoff-watchdog
```

## Deploying to a fresh Hetzner (or any Linux) box — the hard-won playbook

This section documents every real footgun we hit taking the CLI from "tests pass" to "end-to-end Telegram loop working on a real box." Read it before attempting the setup on a new machine — it will save you several hours.

### 1. Run claude as a **non-root** user

Anthropic blocks `--dangerously-skip-permissions` when running as root:

```
--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons
```

Create a dedicated user and do **all** handoff setup under that user:

```bash
useradd -m -s /bin/bash handoff
loginctl enable-linger handoff   # persistent tmux across login sessions
```

### 2. Skip the first-run onboarding wizard

A fresh `handoff` user hits a mandatory interactive wizard on first launch: theme picker → login method → folder trust → MCP server → bypass permissions acceptance. The **hidden flag** that skips the theme + login pickers:

```bash
python3 -c "
import json
p = '/home/handoff/.claude.json'
d = json.load(open(p)) if __import__('os').path.exists(p) else {}
d['hasCompletedOnboarding'] = True
json.dump(d, open(p, 'w'))
"
chmod 600 /home/handoff/.claude.json
```

Per-project trust, MCP server, and bypass acceptance still prompt once. Use `tmux send-keys` to click through them the first time a project is handed off:

```bash
tmux send-keys -t handoff-<target> Enter   # accept folder trust
tmux send-keys -t handoff-<target> "3" Enter   # skip MCP server
tmux send-keys -t handoff-<target> "2" Enter   # accept bypass permissions mode
```

After that the project is remembered and subsequent handoffs launch cleanly.

### 3. OAuth on headless — the `cli.js` patch

Claude Code's OAuth flow auto-detects "no browser" and switches to a manual-paste mode that **does not work** over remote sessions:

- Authorize URL has `redirect_uri=https://platform.claude.com/oauth/code/callback`
- Manual-paste input via TUI can't be driven reliably by `tmux send-keys` or `expect`
- `claude auth login --claudeai` + curl of the local `/callback` endpoint returns `400 Login failed: Invalid state parameter` due to a `redirect_uri` mismatch between the authorize URL (manual path) and the local callback handler (localhost path)

**The fix**: one-line patch to the installed `cli.js` forces the local-callback code path:

```bash
sudo sed -i 's/redirect_uri:Y?n7()\.MANUAL_REDIRECT_URL:/redirect_uri:false?n7().MANUAL_REDIRECT_URL:/g' \
  /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js
# Also the authorize URL builder:
sudo sed -i 's/,z?n7()\.MANUAL_REDIRECT_URL:/,false?n7().MANUAL_REDIRECT_URL:/g' \
  /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js
```

Then set up an SSH port-forward from your Mac to the remote so the browser redirect reaches the remote claude's local HTTP listener:

```bash
# on the remote, start auth and read the random port
ssh handoff@remote 'tmux new-session -d -s auth -x 400 -y 50 "claude auth login --claudeai > /tmp/hclog.txt 2>&1"; sleep 3; ss -tlnp | grep claude'
# note the port, e.g., 38179

# from your Mac, open the SSH tunnel
ssh -f -N -L 38179:localhost:38179 handoff@remote

# then open the authorize URL in your browser (printed in /tmp/hclog.txt)
# browser redirects to http://localhost:38179/callback?code=...&state=...
# tunnel forwards it to the remote claude process
# claude writes credentials.json, exits, you're logged in
```

**Don't probe the local callback endpoint** with a test request — the callback is one-shot and the state check will fail for the real browser request afterward.

**Don't transplant `~/.claude/.credentials.json` from another machine.** It works for ~15 minutes until the access token expires, then auto-refresh fails with 401 because refresh tokens are device/session-bound. Proper native OAuth on the remote is the only path.

This is a monkey-patch. Every claude-code update will overwrite it. Long-term solution is for Anthropic to ship a `--oauth-port` flag or a device-code flow. Until then, reapply the patch after every `npm install -g @anthropic-ai/claude-code`.

### 4. Bun must be in the target user's PATH

The Telegram Channels plugin requires `bun` as a subprocess. If it's installed under `/root/.bun/` it's inaccessible to the handoff user. Install globally:

```bash
curl -fsSL https://bun.sh/install | bash
sudo mv /root/.bun /opt/bun
sudo chown -R root:root /opt/bun && sudo chmod -R a+rX /opt/bun
sudo ln -sf /opt/bun/bin/bun /usr/local/bin/bun
```

### 5. Reinstall plugins after a user migration

`~/.claude/plugins/installed_plugins.json` hardcodes install paths (`/root/.claude/...`). If you copy `.claude` between users, plugin resolution breaks silently (`Plugin telegram not found in marketplace`). Always reinstall per user:

```bash
sudo -u handoff bash -c '
rm -rf /home/handoff/.claude/plugins
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install telegram@claude-plugins-official
'
```

### 6. Bot access via `access.json` (skip the pairing dance)

The Telegram Channels plugin defaults to `dmPolicy: "pairing"` — nobody can DM the bot until they pair via the `/telegram:access pair <code>` slash command typed inside the orchestrator TUI. For a single-user setup, write the allowlist directly:

```bash
cat > /home/handoff/.claude/channels/telegram/access.json <<EOF
{
  "dmPolicy": "allowlist",
  "allowFrom": ["<your-telegram-user-id>"],
  "groups": {},
  "pending": {},
  "mentionPatterns": []
}
EOF
chmod 600 /home/handoff/.claude/channels/telegram/access.json
```

Your numeric Telegram user ID comes from [@userinfobot](https://t.me/userinfobot).

### 7. Watchdog false-positive defense

Claude Code's status bar repeatedly redraws `✗ Auto-update failed · Try claude doctor or npm i -g @anthropic-ai/claude-code`. The default pattern list used to include `✗` — which matched the banner on every redraw and spammed Telegram. The current defaults are narrower (`ERROR|Traceback|FATAL|panic:|segfault`) and the script supports:

- `HANDOFF_WATCH_EXCLUDE` env var (default `Auto-update|auto-update|npm install|npm i -g`) — regex of lines to exclude even if they match a pattern
- `HANDOFF_DEDUPE_SECONDS` env var (default 300) — suppress resending identical hit content within the window, tracked via sha1 hash in `<logDir>/.watchdog/<name>.<hash>.sent`

If you add new patterns to your config, watch the first few hours of real logs and tune the `patterns` and exclude list until Telegram is quiet unless something genuinely broke.

### 8. Per-project setup on first handoff

The first handoff to a project requires you to click through three one-time prompts via `tmux send-keys`: folder trust, MCP server (`3. Continue without`), and bypass permissions (`2. Yes, I accept`). After that the project state is remembered and subsequent handoffs to the same target launch cleanly.

---

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
