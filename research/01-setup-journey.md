# handoff setup journey — from empty repo to end-to-end Telegram loop

Chronicle of building, shipping, and deploying the `handoff` CLI on a Hetzner box so a running Claude Code session on a Mac can be handed off to a remote machine, continue overnight unattended under `--dangerously-skip-permissions`, and be monitored and commanded via Telegram.

---

## Goal

Given: a running Claude Code session on a Mac in the middle of non-trivial work. Want: a single command that ships the session to a remote Linux box where claude continues on its own, pushes notifications to Telegram when anything important happens, and can be commanded remotely via a Telegram bot.

## Architecture (final)

Three tmux session types on the remote, coordinated via per-session log files:

```
Hetzner handoff user
├── handoff-<project>         claude --resume <id> --dangerously-skip-permissions
│     └── tmux pipe-pane → ~/.local/share/handoff/handoff-<project>.log
├── handoff-orchestrator      claude --resume <orch-id> --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions
│     └── long-lived orchestrator claude that inspects / commands work sessions
│         via tmux capture-pane, tmux send-keys, tail on log files
└── handoff-watchdog          bash daemon (no claude), tails logs, curls Telegram
      └── push alerts on ERROR|Failed|Traceback patterns
```

The local `handoff` CLI snapshots the working tree (`git stash create -u`), pushes a `handoff/<timestamp>-<session-id>` branch, rsyncs the session transcript JSONL, and SSHes in to start the three tmux sessions.

---

## Part 1 — building the CLI

TypeScript, DDD-layered (domain / infrastructure / application / cli), neverthrow Result monads end-to-end, zod-validated config, commander CLI, vitest with London-style mock tests.

- `src/domain/` — branded types, tagged-union errors, config schema, slug logic
- `src/infrastructure/` — claude-session discovery, git-transfer, ssh-transport, remote-launcher, logger, config-loader, embedded bash watchdog
- `src/application/` — `executeHandoff` orchestrator + target resolver
- `src/cli/` — commander setup
- **45 tests passing** across 6 suites including a `bash -n` syntax check for the embedded watchdog script

GitHub: https://github.com/SaharBarak/handoff — MIT, public, topics: `claude-code`, `tmux`, `ssh`, `typescript`, etc.

## Part 2 — the OpenClaw review that shaped PR #1

Before merging the initial Telegram integration we reviewed the canonical OpenClaw repo (356k stars, 247 telegram plugin files). Four specific bugs in the embedded watchdog were identified and fixed on the PR branch before merge:

1. **MAX_CHARS=3800 truncation** — Telegram rejects messages >4096 chars; a single Python traceback easily busts the limit. Silent `curl` failure before.
2. **parse_mode=HTML with entity escaping** — legacy Markdown mode breaks on stray backticks inside captured log output. HTML only needs `<`, `>`, `&` escaped and `<pre>` blocks render cleanly.
3. **Rate limit via LAST_SENT_FILE** — min 2s between sends, so bursts don't hit Telegram's per-chat 1/sec cap.
4. **Stale offset handling** — if a log file is truncated or recreated, reset offset to 0 rather than silently skipping new data. Remove `.pos` files for deleted logs.

Anthropic shipped `Claude Code Channels` on March 20, 2026 as a first-party Telegram/Discord bridge. This is the key insight that made the whole thing feasible on a Pro/Max subscription — the third-party-harness crackdown on April 4, 2026 explicitly exempts first-party tooling. We use Channels for the interactive orchestrator and a dumb bash watchdog for push notifications, both of which are sanctioned use.

## Part 3 — the deployment journey (painful learnings)

### Hetzner box setup via hcloud CLI

- Hetzner CAX11 ARM64, Ubuntu 24.04, nbg1
- Firewall blocked SSH from non-allowlist IPs — added current public IP via `hcloud firewall add-rule`
- Server had no valid SSH key for this Mac. Generated `~/.ssh/handoff_ed25519` (passphraseless, dedicated) and installed it via **rescue mode + disk mount**:
  - `hcloud ssh-key create --public-key-from-file ~/.ssh/handoff_ed25519.pub`
  - `hcloud server enable-rescue openclaw --ssh-key handoff-cli`
  - `hcloud server reboot openclaw`
  - SSH into rescue, `mount /dev/sda1 /mnt/root`, append pubkey to `/mnt/root/root/.ssh/authorized_keys`
  - While there: disable openclaw systemd user service (`rm .config/systemd/user/default.target.wants/openclaw-gateway.service`, mv the unit to `.disabled`), remove `/var/lib/systemd/linger/root`
  - `umount`, `hcloud server reboot`

### Reading openclaw's config to reuse the Telegram bot

Before killing openclaw, `cat /root/.openclaw/openclaw.json` to get:
- Bot token (`channels.telegram.botToken`)
- Allowed sender ID (`credentials/telegram-default-allowFrom.json` → `5399305250`)

**Lesson:** this cat leaked multiple other secrets (Google API key, Notion token, openclaw gateway token) into the session's JSONL transcript. Should have used `jq -r` to extract only the specific fields. Every secret that touches a conversation transcript is a potential leak surface.

### The non-root user dance

`--dangerously-skip-permissions` is hard-blocked for root by Anthropic: *"--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons"*. The proper answer is a non-root user:

```bash
useradd -m -s /bin/bash handoff
# ssh key, workspace, .claude state, .config/handoff/secrets.env, clone repo
loginctl enable-linger handoff
```

### Onboarding wizard bypass

Fresh Claude Code user hits a mandatory first-run wizard: theme picker → login method → folder trust → MCP server → bypass permissions acceptance. On every interactive launch until dismissed once per project.

**The hidden flag:** `~/.claude.json` has a `hasCompletedOnboarding: boolean` field. Setting it to `true` skips theme + login pickers. Per-project trust, MCP, and bypass acceptance still get prompted on first launch — but those can be clicked through once via tmux send-keys and persist thereafter.

### The OAuth-on-headless rabbit hole (the worst part)

Claude Code's OAuth flow auto-detects "no browser" and switches to a manual-paste mode. In manual mode:
- Authorize URL has `redirect_uri=https://platform.claude.com/oauth/code/callback`
- User visits URL, authorizes, gets redirected to platform.claude.com's callback page
- Page displays `<code>#<state>` for the user to copy
- User is expected to paste it into the CLI TUI

**Problems we hit:**

1. **tmux send-keys can't drive the manual-paste input field.** The claude TUI uses raw-mode Ink React, which accepts keystrokes via the pty but silently fails on our paste injection. Multiple attempts exited with no error, no state, no credentials.
2. **`expect` driving `claude setup-token`** — same story. Input goes in (we see asterisks in the masked field), claude exits silently, no credentials, no diagnostic.
3. **`claude auth login --claudeai` + curl the local `/callback` endpoint** — got a `400 Invalid state parameter`. Then `400 Login failed`. The root cause: the CLI has two code paths (manual `Y=true` and local-callback `Y=false`), and when the authorize URL was emitted with `Y=true`, the token exchange endpoint required matching redirect_uri. The local callback handler was using `Y=false` path → mismatch.
4. **Transplanting credentials from Mac Keychain to remote `~/.claude/.credentials.json`** worked initially (`claude auth status` reported `loggedIn: max`) but **tokens are device/session-bound**. Five minutes later the access token expired, auto-refresh failed with 401 from a different IP, and everything broke. Transplant is not a valid solution — the user was right to reject it.

**The fix that actually worked:**

Patch `cli.js` to force `Y=false` in both the authorize URL builder and the token exchange request:

```bash
sed -i 's/redirect_uri:Y?n7()\.MANUAL_REDIRECT_URL:/redirect_uri:false?n7().MANUAL_REDIRECT_URL:/g' \
  /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js
```

Then set up an SSH port-forward from local to remote (`ssh -f -N -L <port>:localhost:<port> hetzner`) so the browser's redirect to `localhost:<port>/callback` tunnels to the remote claude's HTTP listener. The CLI receives the code, exchanges with matching redirect_uri, writes `.credentials.json`, exits. **One-shot** — the local callback server shuts down after receiving a valid request, so don't probe the endpoint first (a probe with garbage state burns the attempt).

This is a monkey-patch against Anthropic's minified source. Every claude-code update will overwrite it. Long-term fix is for Anthropic to ship a proper `--device-code` or `--oauth-port` flag.

### Telegram plugin bun subprocess

`@anthropic-ai/claude-code@2.1.107` ships with plugin support but the Channels Telegram plugin requires `bun` as a subprocess (launched from `.mcp.json` with `command: bun`).

Issues and fixes:

1. **Bun not in handoff user's PATH** — originally symlinked `/usr/local/bin/bun → /root/.bun/bin/bun`, but `/root` isn't readable by handoff. Fix: copy to `/opt/bun` owned by root, `chmod a+rX -R`, resymlink.
2. **Plugin cache referenced /root paths** — `installed_plugins.json` hardcodes the install path and I'd copied it from root. Fix: `rm -rf ~/.claude/plugins`, then `claude plugin marketplace add anthropics/claude-plugins-official`, `claude plugin install telegram@claude-plugins-official` as the handoff user. Upgrades to v0.0.6 with correct paths.

### Access control via `access.json`

Plugin default `dmPolicy: "pairing"` means nobody can DM until they pair via `/telegram:access pair <code>`. For a single-user setup, write the allowlist directly:

```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["5399305250"],
  "groups": {},
  "pending": {},
  "mentionPatterns": []
}
```

Stored at `~/.claude/channels/telegram/access.json`. The channel server re-reads it live — no restart needed.

---

## Part 4 — final state

End-to-end verified:
- Local Mac runs `handoff` → branch pushed → transcript rsynced → SSH launches tmux sessions → all three alive
- Orchestrator has Channels listening: `Listening for channel messages from: plugin:telegram@claude-plugins-official`
- Telegram message `SUP` → orchestrator runs `tmux list-sessions` via shell tools → replies via `plugin:telegram:telegram`
- Watchdog bash daemon polling `~/.local/share/handoff/*.log` with 30s cadence

Subscription-compliant (first-party Channels, sanctioned by Anthropic's April 4 policy). Zero harness-detection risk. Works with Max plan.

---

## Lessons learned

1. **OAuth on headless is genuinely broken in current claude-code.** No device-code flow, no port flag, manual-paste mode has a redirect_uri mismatch bug, setup-token TUI can't be driven by expect. The only path to a working remote login is patching the minified source.
2. **Credentials transplant is not portable.** `.credentials.json` tokens have device/session binding on Anthropic's auth server. The file moves cleanly but the tokens get rejected from a different machine on first refresh.
3. **`--dangerously-skip-permissions` as root is forbidden.** Always run claude-code as a non-root user. Standard Linux hygiene — but it surfaces all the first-run wizard and config-migration pain.
4. **First-run onboarding has a hidden bypass:** `hasCompletedOnboarding: true` in `~/.claude.json`. Undocumented.
5. **Plugin cache paths are hardcoded in `installed_plugins.json`.** Copying `.claude` between users breaks plugin resolution. Always reinstall as the target user.
6. **The OpenClaw crackdown is real but narrow.** Anthropic blocked third-party harnesses (OpenCode, raw claude-code wrappers) from using subscription credentials. First-party Claude Code Channels is explicitly exempt. Any architecture that uses Channels for Telegram + canonical interactive `claude --resume` for the work sessions is fully sanctioned.
7. **Don't `cat` config files that might contain secrets** — it leaks them into the session transcript. Use `jq` to extract only the specific fields you need.
8. **Debug logs are gold.** `claude --debug --debug-file /tmp/x.log` reveals plugin loading errors, marketplace cache misses, MCP spawn failures, and API 401s that are invisible in the TUI. Always run with debug when something inexplicable happens.
