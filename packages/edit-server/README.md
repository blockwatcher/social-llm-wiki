# Social LLM Wiki — Edit Server

A lightweight in-browser Markdown editor that runs alongside Quartz, giving every
wiki page an "Edit" button without requiring a separate IDE.

```
Browser → Quartz (port 8080)  ← read-only static site
             │
             │  "Edit this page" link
             ▼
Browser → Edit Server (port 7800)  ← split-view editor + save
             │
             ▼
          wiki/ files on disk
             │
             ▼
          Yjs CRDT sync → libp2p GossipSub
```

---

## Features

- **Split view** — Markdown editor on the left, live preview on the right
- **Auto-preview** — preview updates 400ms after you stop typing
- **Save** — writes directly to the wiki file on disk (`Ctrl+S` / `Cmd+S`)
- **Back link** — returns to the Quartz page after saving
- **Unsaved indicator** — dot in the toolbar when there are unsaved changes
- **Path traversal guard** — only `.md` files inside `WIKI_ROOT` can be edited
- **Zero build step** — plain Node.js, no bundler required

---

## Installation

### Step 1 — Install dependencies

```bash
cd /home/darius/social-llm-wiki
npm install
```

### Step 2 — Start the edit server

```bash
# Production
npm start --workspace=@social-llm-wiki/edit-server

# Development (auto-restart on file changes)
npm run dev --workspace=@social-llm-wiki/edit-server
```

The server starts at `http://127.0.0.1:7800`.

### Step 3 — Add the Edit button to Quartz

Copy the component into your Quartz installation:

```bash
cp packages/edit-server/quartz-component/EditButton.tsx \
   /path/to/your-quartz/quartz/components/EditButton.tsx
```

Export it in `quartz/components/index.ts`:

```ts
export { default as EditButton } from "./EditButton"
```

Add it to your layout in `quartz.layout.ts`:

```ts
import { EditButton } from "./quartz/components"

export const defaultContentPageLayout: PageLayout = {
  // ... your existing layout ...
  afterBody: [EditButton()],
}
```

Rebuild Quartz:

```bash
npx quartz build --serve
```

Every wiki page now shows an "✎ Edit this page" link at the bottom.

---

## Usage

1. Open any page in Quartz (`http://localhost:8080`)
2. Click "✎ Edit this page" at the bottom
3. Edit the Markdown in the left pane — the preview updates live on the right
4. Press `Ctrl+S` (or `Cmd+S` on Mac) or click **Save**
5. Click **← Back** to return to the Quartz page

The saved file is immediately picked up by:
- **Quartz** — if running in `--serve` mode, the page auto-reloads
- **Yjs** — if a file watcher is running, the change propagates via GossipSub

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `WIKI_ROOT` | `/home/darius/social-llm-wiki/wiki` | Absolute path to the wiki directory |
| `EDIT_PORT` | `7800` | Port the edit server listens on |
| `QUARTZ_URL` | `http://localhost:8080` | Quartz URL — used for the "← Back" button |

Example with custom config:

```bash
WIKI_ROOT=/data/wiki EDIT_PORT=7800 QUARTZ_URL=http://localhost:8080 \
  node packages/edit-server/src/index.js
```

---

## API

The edit server exposes a small REST API:

| Method | Path | Description |
|---|---|---|
| `GET` | `/edit?file=<path>` | Returns the editor HTML for the given wiki page |
| `POST` | `/save` | Saves content to disk. Body: `{ file, content }` |
| `POST` | `/preview` | Renders Markdown to HTML. Body: `{ content }` |
| `GET` | `/health` | Returns `{ ok: true, wikiRoot }` |

---

## Running both servers together

Add this to your `package.json` root scripts for a single start command:

```json
{
  "scripts": {
    "wiki": "concurrently \"npx quartz build --serve\" \"npm start --workspace=@social-llm-wiki/edit-server\""
  }
}
```

Or start them in separate terminals:

```bash
# Terminal 1 — Quartz
npx quartz build --serve

# Terminal 2 — Edit server
npm start --workspace=@social-llm-wiki/edit-server
```

---

## Security note

The edit server binds to `127.0.0.1` only — it is not accessible from the network.
If you access Quartz from another device (phone, another computer), the "Edit" link
will not work unless you set up an SSH tunnel or change the bind address.

For remote editing, consider running the edit server behind a reverse proxy
(e.g. nginx or Caddy) with authentication.
