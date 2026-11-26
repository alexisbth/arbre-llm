# Ramifai — POC

A conversation with an LLM, shown as a tree (mind map): each question is a node, and asking a new question from an earlier node starts a new branch.

This proof of concept is meant to assess the user experience on a phone. Without an API key it runs in **demo mode** (simulated answers). With a key, it queries the AI provider you choose: **Claude**, **Gemini**, **Groq**, **OpenRouter** or **ChatGPT**. Gemini, Groq and OpenRouter offer free keys.

## Features

- **Map**: drag to pan, pinch (or mouse wheel) to zoom, tap a node to select it. Arrows point from each question to its follow-ups.
- **Icons**: an emoji before the keyword when it clearly illustrates the content.
- **Merge**: tap "Select", then the nodes to group. The nodes that connect them are added automatically (shown paler). "Merge" turns them into a single node with a "+N" badge. Tap that node to expand it again.
- **Gauges** (bottom corner): tokens used by the current path and by the whole tree, compared with the model's maximum context size. Tap the gauges to change that maximum (200k, 128k, 32k, or 100 to see the alert). Once the path exceeds 80%, "Restart from summary" starts a new conversation from the summary.
- **Bottom panel** (tap the handle to open it):
  - **Thread**: the conversation from the root to the selected node. Tapping an exchange moves the map to it. At the end, one arrow fans out to each follow-up already explored from there; tap it to open that follow-up.
  - **LLM context**: what would be sent to the LLM for a question asked from here, i.e. the summary of earlier steps plus the last 2 exchanges in full, and nothing from neighbouring branches.
- **Ask a question** from any node to create a new branch.
- **AI provider**: menu ⋯ → "Settings", choose the provider, paste its API key and choose the model. With a key, the app asks the provider for its list of models. The answer streams in as it is written, then the LLM fills in the node's card (keyword, emoji, summary). If an error occurs, a "Retry" button appears in the thread.

| Provider | Cost | Where to get a key |
|---|---|---|
| Claude (Anthropic) | Paid (prepaid credits) | platform.claude.com |
| Gemini (Google) | Free tier; Google may use free-tier conversations to improve its products | aistudio.google.com |
| Groq (open models) | Free tier, no card; beyond the limits requests are refused, not billed | console.groq.com |
| OpenRouter | Free models (`openrouter/free` picks one), about 50 free requests a day | openrouter.ai |
| ChatGPT (OpenAI) | Paid; ChatGPT Pro and Business include monthly API credits | platform.openai.com |

Each question uses 2 requests: the answer, then the node's card.

- **Interface language**: menu ⋯ → "Settings" → "Interface language", pick a suggestion or type any language. The first time, the LLM translates all the interface texts in one call (Haiku for Claude); the translation is then kept on the device. "Retranslate" redoes it. Right-to-left languages (Arabic, Hebrew…) mirror the layout. Without an API key the interface stays in English.
- **Menu ⋯**: settings, copy the tree as JSON, reset the example (tap twice).

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

A node is an object `{ id, parent, q, a, kw, sum, ico }`: question, answer, keyword, summary, emoji. The `parent` field alone describes the whole tree. A merge is a connected list of nodes, displayed as a single node.

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
2. A model running inside the browser (WebLLM), free and fully private, on recent phones.
3. LLM-generated summary for each merged node.
4. Move storage to IndexedDB, with file import and export.

## License

To be chosen before release. AGPL-3.0 under consideration (open-core model).
