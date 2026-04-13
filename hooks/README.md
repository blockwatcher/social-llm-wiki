# Claude Code Hooks — Wiki Memory Integration

These hooks connect Claude Code to the Social LLM Wiki, turning the wiki into
a persistent memory layer that is automatically loaded, updated, and extended
across all your Claude Code sessions.

---

## Overview

Claude Code supports lifecycle hooks — shell commands that run automatically
at defined points in a session. These three hooks wire the wiki into that lifecycle:

| Hook file | Event | What it does |
|---|---|---|
| `session-start.js` | `SessionStart` | Loads recent wiki pages as context at session start |
| `session-stop.js` | `Stop` | Saves a session entry to the wiki inbox on exit |
| `post-wiki-edit.js` | `PostToolUse` (Write/Edit) | Queues a maintenance trigger when Claude edits wiki files |

Together they implement the short-term / long-term memory flow described in
[`docs/memory-architecture.md`](../docs/memory-architecture.md):

```
Session starts
    │
    ▼
session-start.js ──► reads wiki/@darius/ ──► Claude sees wiki as context
    │
    │   … session runs …
    │
    ├── Claude edits wiki/ ──► post-wiki-edit.js ──► inbox/triggers/
    │
    ▼
session-stop.js ──► inbox/claude-sessions/YYYY-MM-DD-session.md
    │
    ▼  (later, periodic)
Kai LLM-Review ──► review/candidates/ ──► user approves ──► wiki/ (long-term)
```

---

## Hook Details

### `session-start.js` — Load wiki context

**Claude Code event:** `SessionStart` (fires on `startup` and `resume`)

At the start of every session, this hook reads the most recently modified
Markdown pages from `wiki/@darius/` (or your configured namespace) and
returns them to Claude Code as `additionalContext`. Claude sees these pages
as background knowledge before the first message — no manual copy-paste needed.

**What Claude receives:**

```
## Wiki Memory (@darius)
_8 pages loaded from social-llm-wiki/wiki/@darius/_

### notizen/social-llm-wiki.md
# Social LLM Wiki
Dezentrales Wiki mit Yjs CRDTs + libp2p GossipSub. [...]

### reisen/zugspitze-2026.md
# Zugspitze via Höllental
18,4 km · 2962 Hm · 9h [...]
```

Each page is truncated to 600 characters so context stays compact.
Frontmatter is stripped — Claude sees only the readable content.
Pages are ordered by last-modified date (most recent first).

**Configuration via environment variables:**

| Variable | Default | Description |
|---|---|---|
| `WIKI_ROOT` | `…/social-llm-wiki/wiki` | Absolute path to the wiki root directory |
| `WIKI_NAMESPACE` | `@darius` | Namespace subfolder to load (e.g. `@soenke`, `groups/hiking`) |
| `WIKI_MAX_PAGES` | `10` | Maximum number of pages to include in context |

You can load multiple namespaces by running the hook twice with different
`WIKI_NAMESPACE` values (chain commands with `&&` in the settings).

**When it fires:** On `startup` (new session) and `resume` (--resume flag).
Does not fire on `/clear` or after compaction to avoid re-injecting stale context.

---

### `session-stop.js` — Save session to inbox

**Claude Code event:** `Stop` (fires when Claude finishes responding)

At the end of every session, this hook writes a Markdown entry to
`wiki/inbox/claude-sessions/`. This is the **short-term memory** layer:
a lightweight log of what happened, kept for 30 days.

**Example entry (`wiki/inbox/claude-sessions/2026-04-13-16-25-00-abc12345.md`):**

```markdown
---
channel: claude-session
schema: text/session
ingested: 2026-04-13T16:25:00Z
session_id: abc12345-...
cwd: /home/darius/social-llm-wiki
ttl: 30d
promoted: false
---

# Claude Code Session — 2026-04-13 16:25:00

**Working directory:** `/home/darius/social-llm-wiki`
**Session ID:** `abc12345-...`

## Last user messages

- Kannst du ein Beispiel-Hook für Claude Code bauen...
- Kannst du den hook noch besser dokumentieren...
```

If a transcript file is available, the last 5 user messages are included
as a quick reference. The `promoted: false` flag marks this as unreviewed —
Kai's LLM-review step will later decide whether to promote it to `wiki/`.

**TTL:** Entries older than 30 days are automatically deleted by the
cleanup script (to be implemented — see open questions).

---

### `post-wiki-edit.js` — Queue maintenance trigger

**Claude Code event:** `PostToolUse` — fires after every `Write` or `Edit` tool call

When Claude writes or edits a file inside `wiki/`, this hook drops a small
JSON trigger file into `wiki/inbox/triggers/`. Kai reads these triggers
periodically and re-curates the affected pages (checks links, removes
duplication, updates related pages).

**Example trigger (`wiki/inbox/triggers/2026-04-13T16-25-57Z-maintain.json`):**

```json
{
  "type": "maintain",
  "file": "/home/darius/social-llm-wiki/wiki/@darius/notizen/test.md",
  "tool": "Write",
  "triggered": "2026-04-13T16:25:57.806Z"
}
```

**Safety:** The hook checks that the edited file is actually inside `WIKI_ROOT`
before writing a trigger. Edits to source code or other directories are silently
ignored.

---

## Installation

### Step 1 — Merge the hook configuration

Open `~/.claude/settings.json` (create it if it doesn't exist) and add the
`"hooks"` block from `hooks/settings-example.json`. If you already have a
`settings.json`, merge the `"hooks"` key into your existing file.

```bash
# Open your Claude Code settings
nano ~/.claude/settings.json
```

Minimal example (adjust paths to your actual clone location):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "WIKI_ROOT=/home/darius/social-llm-wiki/wiki WIKI_NAMESPACE=@darius node /home/darius/social-llm-wiki/hooks/session-start.js",
            "timeout": 10000,
            "statusMessage": "Loading wiki context..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "WIKI_ROOT=/home/darius/social-llm-wiki/wiki node /home/darius/social-llm-wiki/hooks/session-stop.js",
            "timeout": 5000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "WIKI_ROOT=/home/darius/social-llm-wiki/wiki node /home/darius/social-llm-wiki/hooks/post-wiki-edit.js",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

### Step 2 — Create your personal namespace

```bash
mkdir -p /home/darius/social-llm-wiki/wiki/@darius/notizen
```

Add your first wiki page and the hook will pick it up on the next session start.

### Step 3 — Verify

Start a new Claude Code session. You should see a brief status message
("Loading wiki context...") and Claude will reference your wiki pages
without being explicitly asked.

---

## Testing the hooks manually

You can test each hook from the terminal before trusting them in a live session:

```bash
cd /home/darius/social-llm-wiki

# Test session-start (should print JSON with additionalContext)
echo '{"session_id":"test","cwd":"/home/darius","source":"startup"}' \
  | WIKI_ROOT=./wiki node hooks/session-start.js | jq .

# Test session-stop (should create a file in wiki/inbox/claude-sessions/)
echo '{"session_id":"test-abc","cwd":"/home/darius"}' \
  | WIKI_ROOT=./wiki node hooks/session-stop.js
ls wiki/inbox/claude-sessions/

# Test post-wiki-edit (should create a trigger in wiki/inbox/triggers/)
echo '{"tool_name":"Write","tool_input":{"file_path":"'$(pwd)'/wiki/@darius/notizen/test.md"}}' \
  | WIKI_ROOT=./wiki node hooks/post-wiki-edit.js
ls wiki/inbox/triggers/
```

---

## How Claude Code hooks work

Claude Code hooks are shell commands defined in `~/.claude/settings.json`.
They fire automatically at lifecycle events and can inject additional context
into Claude's conversation.

**Key mechanics used here:**

- **`additionalContext`** (SessionStart): When a hook returns a JSON object
  with `hookSpecificOutput.additionalContext`, Claude Code injects that text
  into the session context. This is how `session-start.js` loads wiki pages
  without you having to copy-paste them.

- **Matchers**: `"startup|resume"` limits the SessionStart hook to real
  session starts, not `/clear` commands. `"Write|Edit"` limits the
  PostToolUse hook to file-writing tools only.

- **Timeout**: Hooks that exceed their timeout are skipped silently.
  Keep context-loading fast (< 5s) to avoid slowing down session start.

- **Environment variables**: Set `WIKI_ROOT` and `WIKI_NAMESPACE` directly
  in the command string to configure the hook per-project or per-namespace.

Full Claude Code hook documentation: `claude hooks` or `/hooks` in-session.

---

## Open questions / next steps

- **Cleanup script**: TTL enforcement for `inbox/` entries (delete after 30d)
- **Smarter context loading**: Instead of recency, use keyword matching against
  the current working directory or recent conversation to load *relevant* pages
- **Multi-namespace**: Load both `@darius/` and `groups/hiking/` in one session
- **Review notification**: After `session-stop.js` accumulates N entries,
  trigger a Matrix message prompting Kai's LLM-review step
