# Ramifai remote connector (server)

The same tools as the [local connector](../mcp/README.md) (`list_trees`, `create_tree`, `show_tree`, `read_branch`, `add_exchange`), hosted on a server, for assistants that only accept connectors on the internet: claude.ai and its phone apps, ChatGPT, and others.

This code is public on purpose: anyone can check what the server does with the trees.

**Connector address:** `https://rhxlsyymnenlvureuxdf.supabase.co/functions/v1/mcp`

## How it works

- **Hosting**: a [Supabase](https://supabase.com) project. The connector is an Edge Function (`supabase/functions/mcp`), the trees are in a Postgres table (`supabase/migrations`).
- **Sign-in (OAuth 2.1)**: the connector answers 401 to a request without a valid token, with the address of its description (`/.well-known/oauth-protected-resource`). The description names the sign-in server, Supabase Auth. The assistant registers itself there, then sends the user to the app's page [`consent.html`](../consent.html). There, the user signs in with a code received by email, sees which assistant asks and where it will go back, then allows or denies. The assistant then gets an access token for that user only.
- **Access to the trees**: every request carries the user's token, and the connector reads and writes with it. The database's row-level security (RLS) only lets each user reach their own trees. The function holds no secret key.
- **Drawn tree (MCP Apps)**: `show_tree` and `add_exchange` also show the tree drawn (`supabase/functions/mcp/view.ts`). On a computer, Claude opens it in its side panel, next to the chat; in the conversation, a card shows the whole tree and an "Open the tree" button (full screen on a phone). In the panel: pan, zoom, "Fit", and the thread from the start to the chosen box. Colours and font follow Claude's. The drawing asks for the whole tree with `get_tree_view`, a tool only the drawing can call, so the answers are not sent to the model again.
- **The tools never delete**: they only create trees and add boxes. A box is added in one database statement, so two boxes added at the same moment are both kept.

## Privacy

- To answer from a tree, the assistant must read it, so the server can read it too: these trees are **not** end-to-end encrypted. Supabase encrypts them on its disks, and each user only reaches their own.
- The trees are stored in the European Union (Paris region).
- The assistant sees what it reads through the tools, and keeps it according to its own policy (Anthropic, OpenAI…).

## Add the connector to an assistant

- **claude.ai** (also used by the Claude phone apps): Settings → Connectors → Add custom connector, then paste the connector address. Claude opens the Ramifai page: sign in, then allow.
- **ChatGPT**: Settings → Apps → Advanced settings → Developer mode, then create an app with the connector address.
- **Claude Code**: `claude mcp add --transport http ramifai https://rhxlsyymnenlvureuxdf.supabase.co/functions/v1/mcp`

## Set up a new Supabase project

1. Apply the migration in `supabase/migrations`, then deploy the function: `supabase functions deploy --no-verify-jwt mcp` (the function checks tokens itself, so that it can answer the 401 that starts the sign-in).
2. In the dashboard, **Authentication → URL Configuration**: Site URL = the app's address (`https://alexisbth.github.io/arbre-llm`); add the same address followed by `/**` to the Redirect URLs.
3. **Authentication → OAuth Server**: turn on the OAuth 2.1 server (beta), Authorization Path = `/consent.html`, turn on dynamic client registration (assistants register themselves).
4. **Authentication → Emails → Magic Link** template: add `{{ .Token }}` so the email contains the code typed on the consent page.
5. Supabase's built-in email service only sends to the project's team members and a few emails per hour: for other users, set up your own email provider (Authentication → Emails → SMTP).
6. In `consent.js`, set `SUPABASE_URL` and `PUBLIC_KEY` (the project's publishable key, public by design).

## Tests done

The function was run locally against a stand-in for Supabase, calling every tool, with and without a valid token. The row-level security was checked in SQL with two users: neither can read nor change the other's trees.
