# Ramifai remote connector (server)

The tools of the [local connector](../mcp/README.md) (`list_trees`, `create_tree`, `show_tree`, `read_branch`, `add_exchange`), plus `start_ramifai` and a drawn tree, hosted on a server, for assistants that only accept connectors on the internet: claude.ai and its phone apps, ChatGPT, and others.

This code is public on purpose: anyone can check what the server does with the trees.

**Connector address:** `https://rhxlsyymnenlvureuxdf.supabase.co/functions/v1/mcp`

**Not technical? No GitHub?** Send people this page, in French and English, with every step explained: <https://alexisbth.github.io/arbre-llm/guide.html>

## How it works

- **Hosting**: a [Supabase](https://supabase.com) project. The connector is an Edge Function (`supabase/functions/mcp`), the trees are in a Postgres table (`supabase/migrations`).
- **Sign-in (OAuth 2.1)**: the connector answers 401 to a request without a valid token, with the address of its description (`/.well-known/oauth-protected-resource`). The description names the sign-in server, Supabase Auth. The assistant registers itself there, then sends the user to the app's page [`consent.html`](../consent.html). There, the user signs in with a code received by email, sees which assistant asks and where it will go back, then allows or denies. The assistant then gets an access token for that user only.
- **Access to the trees**: every request carries the user's token, and the connector reads and writes with it. The database's row-level security (RLS) only lets each user reach their own trees. The function holds no secret key.
- **Start Ramifai**: say "start Ramifai" (in any language), optionally with a tree name. The assistant calls `start_ramifai`, which opens the tree with that exact name or creates it, draws it, and tells the assistant to record every exchange with `add_exchange` until you say to stop. The start command itself is never recorded. The assistant chooses where each box goes: under the box the question follows from, or from the start for a new subject.
- **The "Start" box**: a new tree begins with a box titled "Start", so you see where it begins. It is hidden from the drawing as soon as the first real box exists.
- **Drawn tree (MCP Apps)**: `start_ramifai` and `show_tree` also show the tree drawn (`supabase/functions/mcp/view.ts`). On a computer, Claude opens it in its side panel, next to the chat; in the conversation, a card shows the whole tree and an "Open the tree" button (full screen on a phone). In the panel: pan, zoom, "Fit", and the thread from the start to the current box. The drawing updates itself every few seconds while it is shown, so new boxes appear as you talk. Colours and font follow Claude's. The drawing asks for the tree with `get_tree_view`, a tool only the drawing can call, so the answers are not sent to the model again.
- **Next question here**: tap a box in the drawing. It turns yellow with a "Next question here" flag, and a yellow banner names it (with Cancel). The next box goes under it, whatever box the assistant chose: the tapped box is kept in the database (`next_parent`, written by `pick_box`, a tool only the drawing can call) and used by `add_tree_node`, then cleared. The assistant is told which box was tapped too, when the app passes it context from the drawing.
- **The tools never delete**: they only create trees and add boxes. A box is added in one database statement, so two boxes added at the same moment are both kept.
- **Protocol versions**: the connector speaks MCP 2026-07-28 (each request carries everything it needs) and the 2025 versions (a handshake first), so older and newer assistants both work. Built with the official TypeScript SDK v2 (`@modelcontextprotocol/server`).

## Privacy

- To answer from a tree, the assistant must read it, so the server can read it too: these trees are **not** end-to-end encrypted. Supabase encrypts them on its disks, and each user only reaches their own.
- The trees are stored in the European Union (Paris region).
- The assistant sees what it reads through the tools, and keeps it according to its own policy (Anthropic, OpenAI…).
- The server's logs keep, for each request, only its kind (for example `tools/call show_tree`), the names of its fields and the answer's status, to fix problems. Never a question, an answer, a tree or a token.

## Add the connector to an assistant

- **claude.ai** (also used by the Claude phone apps): Settings → Connectors → Add custom connector, then paste the connector address. Claude opens the Ramifai page: sign in, then allow.
- **ChatGPT**: Settings → Apps → Advanced settings → Developer mode, then create an app with the connector address.
- **Claude Code**: `claude mcp add --transport http ramifai https://rhxlsyymnenlvureuxdf.supabase.co/functions/v1/mcp`

## Set up a new Supabase project

1. Apply the migration in `supabase/migrations`, then deploy the function: `supabase functions deploy --no-verify-jwt mcp` (the function checks tokens itself, so that it can answer the 401 that starts the sign-in).
2. In the dashboard, **Authentication → URL Configuration**: Site URL = the app's address (`https://alexisbth.github.io/arbre-llm`); add the same address followed by `/**` to the Redirect URLs.
3. **Authentication → OAuth Server**: turn on the OAuth 2.1 server (beta), Authorization Path = `/consent.html`, turn on dynamic client registration (assistants register themselves).
4. **Authentication → Emails → Magic Link** template: add `{{ .Token }}` so the email contains the code typed on the consent page.
5. Supabase's built-in email service only sends to the project's team members and a few emails per hour: for other users, set up your own email provider (Authentication → Emails → SMTP Settings → Enable custom SMTP). With [Brevo](https://www.brevo.com) (free plan: 300 emails a day):
   1. **Own a domain** (a free address such as Gmail is rejected). In Brevo, Settings → Senders, domains & dedicated IPs → Domains → add the domain → *Authenticate*. Brevo lists the DNS records to create at your domain registrar: two `CNAME` (`brevo1._domainkey`, `brevo2._domainkey`, targets ending with a dot), a `TXT` `_dmarc` (`v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`) and a `TXT` on the domain itself (`brevo-code:…`). Wait until Brevo shows the domain as *Authenticated*.
   2. In Brevo, add the sender (for example `no-reply@yourdomain`). It must be able to receive the verification email: create a mailbox or an alias at your registrar first. Sending can already work while the sender shows as unverified, as long as the domain is authenticated.
   3. In Brevo, SMTP & API → SMTP → generate an SMTP key (shown once: copy it at once, never commit it).
   4. **Turn off the IP blocking for SMTP keys** (Brevo → Security → Authorised IPs). Supabase sends from changing addresses; with the blocking on, every email fails with "unauthorized IP address".
   5. In Supabase, SMTP Settings: sender email = the Brevo sender; host `smtp-relay.brevo.com`; port `587`; username = the SMTP login shown by Brevo (ends with `@smtp-brevo.com`); password = the SMTP key. Save, then send yourself a test (Authentication → Users → a confirmed user → *Send magic link*).
   6. Renew the SMTP key before it expires, or sign-in codes stop. Supabase also limits one email per minute and per address.
6. In `consent.js`, set `SUPABASE_URL` and `PUBLIC_KEY` (the project's publishable key, public by design).

## Tests done

The function was run locally against a stand-in for Supabase, calling every tool, with and without a valid token, with both protocol versions. The row-level security was checked in SQL with two users: neither can read nor change the other's trees.
