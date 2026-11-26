# Ramifai — POC

A conversation with an LLM, shown as a tree (mind map): each question is a node, and asking a new question from an earlier node starts a new branch.

This proof of concept is meant to assess the user experience on a phone. Without an API key it runs in **demo mode** (simulated answers). With a key, it queries the AI provider you choose: **Claude**, **Gemini**, **Groq**, **OpenRouter** or **ChatGPT**. Gemini, Groq and OpenRouter offer free keys.

## Features

- **Map**: drag to pan, pinch (or mouse wheel) to zoom, tap a node to select it. Arrows point from each question to its follow-ups.
- **Icons**: an emoji before the keyword when it clearly illustrates the content.
- **Merge**: tap "Select", then the nodes to group. The nodes that connect them are added automatically (shown paler). "Merge" turns them into a single node with a "+N" badge. Tap that node to expand it again.
- **Gauges** (bottom corner): tokens used by the current path and by the whole tree, compared with the model's maximum context size. Tap the gauges to change that maximum (200k, 128k, 32k, or 100 to see the alert). Once the path exceeds 80%, a "Synthesis" button appears (see below).
- **Bottom panel** (tap the handle to open it):
  - **Thread**: the conversation from the root to the selected node. Tapping an exchange moves the map to it. At the end, one arrow fans out to each follow-up already explored from there; tap it to open that follow-up.
  - **LLM context**: what would be sent to the LLM for a question asked from here, i.e. the summary of earlier steps plus the last 2 exchanges in full, and nothing from neighbouring branches.
- **Ask a question**: just write, as in any chat. By default the app finds the right box for it (continue here, go back to an earlier topic, or start a new one) and says where it placed it, with a "Move" button. The 📍 marker above the question box shows where the next question goes; tap it, or tap a box, to keep the question there. Settings → "New questions":
  - *accurate* (default): a first small request chooses the box, then the answer gets that branch's context (3 requests per question);
  - *economical*: one request answers, chooses the box and fills in the card (1 request per question, less reliable);
  - *always where I am*: no automatic placement (2 requests per question).
- **Versions**: under the current answer, "Regenerate" writes a new version, with the provider of your choice when several have a key. ‹ › switch between versions; "Merge versions" asks the LLM for one answer combining them. Every version is kept. A follow-up remembers which version it was asked from.
- **Move**: puts a box, with its branch, under another parent.
- **Synthesis** (menu ⋯, or the button that appears when the path is nearly full): written by the LLM so you can carry on from where you are, here or in another app ("Copy"), or in a new branch of the same tree. If the AI cannot be reached, the summaries of the boxes are put end to end instead.
- **Limit reached** (quota or credits used up): the app offers to continue with another provider that has a key, or to open the synthesis.
- **Export** (menu ⋯): HTML (the tree drawn, then every box with its content, in one light page), PDF (through the print window), Markdown, OPML (for mind-map apps) or JSON.
- **Open a file** (menu ⋯): opens a JSON export, or a tree written by the MCP connector (below). It replaces the tree on screen, after confirmation.
- **MCP connector** (folder [`mcp/`](mcp/)): lets your AI assistant (Claude Desktop, Claude Code, VS Code, Cursor, Gemini CLI…) list your trees, read a branch and add exchanges to it, in a folder of your computer. See [mcp/README.md](mcp/README.md).
- **AI provider**: menu ⋯ → "Settings", choose the provider, paste its API key and choose the model. With a key, the app asks the provider for its list of models. The answer streams in as it is written, then the LLM fills in the node's card (keyword, emoji, summary). If an error occurs, a "Retry" button appears in the thread.

| Provider | Cost | Where to get a key |
|---|---|---|
| Claude (Anthropic) | Paid (prepaid credits) | platform.claude.com |
| Gemini (Google) | Free tier; Google may use free-tier conversations to improve its products | aistudio.google.com |
| Groq (open models) | Free tier, no card; beyond the limits requests are refused, not billed | console.groq.com |
| OpenRouter | Free models (`openrouter/free` picks one), about 50 free requests a day | "Sign in with OpenRouter" button, or openrouter.ai |
| ChatGPT (OpenAI) | Paid; ChatGPT Pro and Business include monthly API credits | platform.openai.com |

A question uses 2 requests (the answer, then the node's card), plus 1 when the app places it automatically in accurate mode.

- **Sign in with OpenRouter** (Settings, provider OpenRouter): no key to copy. The app sends you to openrouter.ai, you sign in, and you come back with a key linked to your account. The app uses OAuth PKCE: a random secret stays in the tab, only its hash leaves it, so a stolen sign-in code alone is useless. On an iPhone, if the app installed on the home screen does not get the key, sign in from Safari, or paste a key.

- **Interface language**: menu ⋯ → "Settings" → "Interface language", pick a suggestion or type any language. The first time, the LLM translates all the interface texts in one call (Haiku for Claude); the translation is then kept on the device. "Retranslate" redoes it. Right-to-left languages (Arabic, Hebrew…) mirror the layout. Without an API key the interface stays in English.
- **Menu ⋯**: settings, synthesis, open a file, export, reset the example (tap twice).

## API key and security

- Each key stays on the device and is only sent to its own provider. The page's security policy (CSP) allows only these external addresses: `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.groq.com`, `openrouter.ai`, `api.openai.com`.
- Keys are kept after closing the app only if "Keep the key on this device" is ticked. They are never included in the JSON export.
- For paid providers, set a spending limit in their console.
- Translated interface texts are checked before use: a text that loses or gains a placeholder such as `{count}` falls back to English. All text is inserted with `textContent`, never as HTML.

## How it works

| File | Role |
|---|---|
| `index.html` | Page structure (texts marked with `data-i18n`) |
| `style.css` | Look and feel (light and dark themes, right-to-left support) |
| `app.js` | Data, merging, tree layout, SVG drawing, gestures, panel, gauges, LLM calls, translation |
| `manifest.webmanifest`, `sw.js` | Make the site installable (PWA) and usable offline |

A node is an object `{ id, parent, q, a, kw, sum, ico }`: question, answer, keyword, summary, emoji. The `parent` field alone describes the whole tree. `versions` keeps every version of the answer, `v` is the one shown, and `pv` is the parent's version the question was asked from. A merge is a connected list of nodes, displayed as a single node.

For a question asked from a node, the app sends the LLM: an instruction, the summary of the earlier steps of the path, the last 2 exchanges in full, then the question. Neighbouring branches are never sent.

The interface texts live in the `UI` object of `app.js` (English reference). A translation is stored per language with a version number, so it is redone automatically when the English texts change.

Data stays in the browser (`localStorage`). No external library, no server. A security policy (CSP) blocks any third-party script. The gauges use the actual number of answer tokens returned by the API when known, and an estimate otherwise (1 token ≈ 4 characters).

## Install on a phone

- **Android (Chrome)**: open the link, menu ⋮, then "Install app".
- **iPhone (Safari)**: open the link, Share button, then "Add to Home Screen".

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Next steps

1. Sync and sharing with Supabase (data encrypted on the device): premium feature.
2. Remote MCP connector (on a server, with sign-in), for phones and ChatGPT, which only accept remote connectors.
3. Build a tree from an old conversation.
4. A model running inside the browser (WebLLM), free and fully private, on recent phones.
5. LLM-generated summary for each merged node.
6. Move storage to IndexedDB, with several trees on the device.

## License

To be chosen before release. AGPL-3.0 under consideration (open-core model).
