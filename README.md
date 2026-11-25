# Arbre LLM — POC

A conversation with an LLM, shown as a tree (mind map): each question is a node, and asking a new question from an earlier node starts a new branch.

This proof of concept is meant to assess the user experience on a phone. Without an API key it runs in **demo mode** (simulated answers). With an Anthropic API key, it queries **Claude**.

## Features

- **Map**: drag to pan, pinch (or mouse wheel) to zoom, tap a node to select it. Arrows point from each question to its follow-ups.
- **Icons**: an emoji before the keyword when it clearly illustrates the content.
- **Merge**: tap "Sélection", then the nodes to group. The nodes that connect them are added automatically (shown paler). "Fusionner" turns them into a single node with a "+N" badge. Tap that node to expand it again.
- **Gauges** (bottom right): tokens used by the current path and by the whole tree, compared with the model's maximum context size. Tap the gauges to change that maximum (200k, 128k, 32k, or 100 to see the alert). Once the path exceeds 80%, "Repartir du résumé" starts a new conversation from the summary.
- **Bottom panel** (tap the handle to open it):
  - **Fil** (thread): the conversation from the root to the selected node. Tapping an exchange moves the map to it.
  - **Contexte LLM**: what would be sent to the LLM for a question asked from here, i.e. the summary of earlier steps plus the last 2 exchanges in full, and nothing from neighbouring branches.
- **Ask a question** from any node to create a new branch.
- **Claude**: menu ⋯ → "Réglages du LLM", paste your API key (created in the Claude Console, platform.claude.com) and choose the model. The answer streams in as it is written. Haiku then fills in the node's card (keyword, emoji, summary). If an error occurs, a "Réessayer" (retry) button appears in the thread.
- **Menu ⋯**: LLM settings, copy the tree as JSON, reset the example (tap twice).

## API key and security

- The key stays on the device. It is only sent to `api.anthropic.com`, the only external address the page's security policy (CSP) allows.
- It is kept after closing the app only if "Garder la clé sur cet appareil" (keep the key on this device) is checked. It is never included in the JSON export.
- A Claude subscription (Pro…) does not include the API: API usage is billed separately in the Claude Console. Set a spending limit there.

## How it works

| File | Role |
|---|---|
| `index.html` | Page structure |
| `style.css` | Look and feel (light and dark themes) |
| `app.js` | Data, merging, tree layout, SVG drawing, gestures, panel, gauges, LLM calls |
| `manifest.webmanifest`, `sw.js` | Make the site installable (PWA) and usable offline |

A node is an object `{ id, parent, q, a, kw, sum, ico }`: question, answer, keyword, summary, emoji. The `parent` field alone describes the whole tree. A merge is a connected list of nodes, displayed as a single node.

For a question asked from a node, the app sends Claude: an instruction, the summary of the earlier steps of the path, the last 2 exchanges in full, then the question. Neighbouring branches are never sent.

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
2. Other LLM providers (OpenAI, Mistral, local models).
3. LLM-generated summary for each merged node.
4. Move storage to IndexedDB, with file import and export.

## License

To be chosen before release. AGPL-3.0 under consideration (open-core model).
