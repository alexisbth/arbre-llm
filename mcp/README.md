# Ramifai MCP connector (local)

Lets your AI assistant work with your Ramifai trees: list them, see their plan, read a branch, and add new exchanges to it.

**MCP** (Model Context Protocol) is an open standard that lets an AI assistant use outside tools. This connector is a small program that runs **on your computer**: your assistant starts it by itself and talks to it directly. Nothing goes on the internet, so no account and no sign-in are needed.

Your trees are kept as files in a folder of your computer: `Ramifai` in your home folder (or the folder you choose, see below). Each tree is one `.json` file, in the same format as the app's JSON export. So:

- to give a tree from the app to your assistant: in the app, menu ⋯ → Export → JSON, then move the file into the `Ramifai` folder;
- to see in the app a tree your assistant wrote: menu ⋯ → Open a file, then pick it in the `Ramifai` folder.

## Which assistants

Any assistant that runs local MCP connectors, for example Claude Desktop, Claude Code, VS Code (Copilot), Cursor or Gemini CLI. On a computer only.

ChatGPT and the phone apps only accept connectors hosted on a server: use the [remote connector](../server/README.md) for them.

## Install

1. Install **Node.js** (version 18 or later) from [nodejs.org](https://nodejs.org).
2. Get the code: download this repository (green "Code" button → "Download ZIP", then unzip it), or `git clone https://github.com/alexisbth/arbre-llm.git`.
3. In a terminal, go to the `mcp` folder and install the connector's libraries:

   ```bash
   cd arbre-llm/mcp
   npm install
   ```

4. Note the full path of `server.js`, for example `/Users/alex/arbre-llm/mcp/server.js` (Mac) or `C:\Users\alex\arbre-llm\mcp\server.js` (Windows).

## Connect it to your assistant

**Claude Desktop**: Settings → Developer → "Edit Config". This opens `claude_desktop_config.json`. Put this in it (with your path to `server.js`), save, then quit and reopen Claude:

```json
{
  "mcpServers": {
    "ramifai": {
      "command": "node",
      "args": ["/Users/alex/arbre-llm/mcp/server.js"]
    }
  }
}
```

On Windows, write the path with double backslashes: `"C:\\Users\\alex\\arbre-llm\\mcp\\server.js"`.

**Claude Code**: `claude mcp add ramifai -- node /Users/alex/arbre-llm/mcp/server.js`

**Cursor** (`~/.cursor/mcp.json`) and **Gemini CLI** (`~/.gemini/settings.json`): the same `mcpServers` block as Claude Desktop.

**VS Code** (`.vscode/mcp.json`): the same block, but named `servers` instead of `mcpServers`, with `"type": "stdio"` added next to `"command"`.

**Another folder for the trees**: add `"env": { "RAMIFAI_DIR": "/path/to/your/folder" }` next to `"args"`.

## Use it

Just ask, for example:

- "Show me my Ramifai trees."
- "Create a Ramifai tree called Electricity, and save this conversation in it."
- "Continue my Electricity tree from the box about Ohm's law: why does a wire heat up?"

The assistant then uses these tools:

| Tool | What it does |
|---|---|
| `list_trees` | The trees in the folder: name, title, number of boxes, last change |
| `create_tree` | Creates an empty tree |
| `show_tree` | The plan of a tree: one line per box (id, emoji, keyword, summary) |
| `read_branch` | The context of a box: the path from the start, as summaries, with the last 2 exchanges in full |
| `add_exchange` | Adds a question and its answer as a new box under another one |

The connector never deletes anything: it only adds boxes and trees.

## Test

```bash
npm test
```

Starts the connector in a temporary folder and calls every tool.
