/* Ramifai — sign-in and consent page for assistants (remote MCP connector, folder server/)
 *
 * An assistant (Claude, ChatGPT…) asks to reach the user's Ramifai trees. Supabase Auth, the sign-in server,
 * sends the user here with an "authorization_id". This page:
 * 1. signs the user in with a code sent by email (or the link in that email), if not signed in yet;
 * 2. shows which assistant asks and where the user will go back, then sends the answer (allow or deny);
 * 3. follows the address Supabase Auth returns: back to the assistant, with access granted or refused.
 * The session (access and refresh tokens) is kept in this browser, only to sign in to Ramifai.
 * Security: all text is inserted with textContent, no third-party script.
 */
{
  const SUPABASE_URL = 'https://rhxlsyymnenlvureuxdf.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_uwqckGNnWDewik4vfDG3bA_Kqmp-e-Z';   // public by design: it only lets requests reach the API
  const SESSION_KEY = 'ramifai-account';
  const EMAIL_KEY = 'ramifai-account-email';   // sessionStorage: email waiting for its code
  const EXPIRY_MARGIN = 60;                     // s: a token this close to its end is refreshed first
  const AUTH = `${SUPABASE_URL}/auth/v1`;
  const $ = id => document.getElementById(id);
  const authorizationId = new URLSearchParams(location.search).get('authorization_id');

  // ---------- Screen ----------
  function show(id) {                           // one form at a time
    for (const s of ['email-form', 'code-form', 'consent']) $(s).hidden = s !== id;
  }
  function status(text, error = false) {
    $('status').textContent = text;
    $('status').classList.toggle('error', error);
  }
  function busy(on) { document.querySelectorAll('button').forEach(b => { b.disabled = on; }); }

  // ---------- Calls to Supabase Auth ----------
  async function call(method, path, { body, token } = {}) {
    const headers = { apikey: PUBLIC_KEY, 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(AUTH + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.msg || data.message || data.error_description || data.error || `Error ${r.status}`), { status: r.status });
    return data;
  }

  // ---------- Session ----------
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  }
  function keepSession(s) {
    const session = { access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: s.expires_at || nowSeconds() + Number(s.expires_in || 0), email: s.user?.email || s.email || '' };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* storage refused: this visit only */ }
    return session;
  }
  function forget() { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignored */ } }
  // A valid session, refreshed if it is about to end; null if the user must sign in again
  async function session() {
    const s = readSession();
    if (!s?.access_token) return null;
    if (s.expires_at - EXPIRY_MARGIN > nowSeconds()) return s;
    try { return keepSession({ ...await call('POST', '/token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } }), email: s.email }); }
    catch { forget(); return null; }
  }
  // Coming back from the link in the email: the tokens are in the address, after "#"
  function sessionFromLink() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('access_token')) {
      keepSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'),
        expires_at: Number(h.get('expires_at')) || undefined, expires_in: h.get('expires_in') });
    } else if (h.get('error_description')) status(h.get('error_description'), true);
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);   // tokens leave the address bar
  }

  // ---------- Sign-in with a code sent by email ----------
  $('email-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('email').value.trim();
    busy(true);
    try {
      const back = encodeURIComponent(location.origin + location.pathname + location.search);
      await call('POST', `/otp?redirect_to=${back}`, { body: { email, create_user: true } });
      try { sessionStorage.setItem(EMAIL_KEY, email); } catch { /* ignored */ }
      $('code-email').textContent = email;
      status('');
      show('code-form');
      $('code').focus();
    } catch (err) { status(err.message, true); }
    busy(false);
  });
  $('code-form').addEventListener('submit', async e => {
    e.preventDefault();
    busy(true);
    try {
      keepSession(await call('POST', '/verify', { body: { type: 'email', email: $('code-email').textContent, token: $('code').value.trim() } }));
      await askConsent();
    } catch (err) { status(err.message, true); }
    busy(false);
  });
  $('other-email').addEventListener('click', () => { status(''); show('email-form'); });
  $('sign-out').addEventListener('click', () => { forget(); status(''); show('email-form'); });

  // ---------- Consent ----------
  async function askConsent() {
    const s = await session();
    if (!s) {
      const pending = (() => { try { return sessionStorage.getItem(EMAIL_KEY); } catch { return null; } })();
      if (pending) { $('code-email').textContent = pending; show('code-form'); } else show('email-form');
      return;
    }
    status('Loading…');
    let details;
    try { details = await call('GET', `/oauth/authorizations/${encodeURIComponent(authorizationId)}`, { token: s.access_token }); }
    catch (err) {
      if (err.status === 401) { forget(); status('Please sign in again.', true); show('email-form'); return; }
      status(`${err.message}. Go back to your assistant and connect Ramifai again.`, true);
      return;
    }
    if (!details.authorization_id && details.redirect_url) { location.assign(details.redirect_url); return; }   // already allowed before
    $('client-name').textContent = details.client?.name || 'An assistant';
    $('client-host').textContent = hostOf(details.redirect_uri);
    $('user-email').textContent = details.user?.email || s.email;
    status('');
    show('consent');
  }
  const hostOf = url => { try { return new URL(url).host; } catch { return url || '?'; } };
  async function decide(action) {
    busy(true);
    try {
      const s = await session();
      if (!s) { show('email-form'); busy(false); return; }
      const { redirect_url: next } = await call('POST', `/oauth/authorizations/${encodeURIComponent(authorizationId)}/consent`,
        { token: s.access_token, body: { action } });
      status(action === 'approve' ? 'Allowed. Going back to your assistant…' : 'Denied. Going back to your assistant…');
      location.assign(next);
    } catch (err) { status(err.message, true); busy(false); }
  }
  $('approve').addEventListener('click', () => decide('approve'));
  $('deny').addEventListener('click', () => decide('deny'));

  // ---------- Startup ----------
  sessionFromLink();
  if (!authorizationId) status('This page opens from your assistant, when you connect Ramifai to it.', true);
  else askConsent();
}
