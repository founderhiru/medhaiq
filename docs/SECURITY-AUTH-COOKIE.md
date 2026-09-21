# Signed authentication cookie (Slice 0)

## What was wrong

The login cookie `user_id` used to contain a bare number (for example `42`), and every
part of the app trusted it. Anyone who typed `Cookie: user_id=1` into a request — or edited
the cookie in their browser — was treated as user 1, including the founder account. There
was no signature to check.

## What changed

The cookie now contains a signed value:

```
v1.<userId>.<issuedAt>.<expiresAt>.<signature>
```

The signature is an HMAC-SHA256 of the first four parts using a secret only the server
knows (`AUTH_COOKIE_SECRET`). Editing any part invalidates it. Expiry is enforced on the
server, not just by the browser.

Two new files and one added line do all of this. **No existing auth, guard, capability, or
interview file was edited.**

| File | Role |
|---|---|
| `lib/auth-cookie.js` | Pure sign / verify functions |
| `middleware/auth-cookie.js` | Verifies the cookie on every request; signs any `user_id` cookie the app issues |
| `server.js` (one added line) | Mounts the middleware right after the cookie parser |
| `tests/auth-cookie-security.js` | 60 automated checks |

How existing code keeps working unchanged: the middleware replaces `req.cookies.user_id` with
the *verified* id (same plain-number shape as before), or removes it if the cookie is forged,
old-format, tampered or expired. Every existing reader then sees either the real user or
"signed out". Login code in `routes/auth.js` still calls `res.cookie('user_id', …)`; the
middleware signs it on the way out.

## Environment variables (Render)

| Variable | Required | Value |
|---|---|---|
| `AUTH_COOKIE_SECRET` | **Yes** | A random string of **at least 32 characters** (64 recommended). Keep it private. |
| `AUTH_COOKIE_MODE` | No | Leave **unset** (= `enforce`). `transition` is an emergency rollback only — see below. |

Ways to make a secret: run `openssl rand -hex 32` in a terminal, or have a password manager
generate a 64-character random string using letters and numbers. Never paste it into a chat,
an issue, or a commit. Use a **different** secret for staging and production.

## Deploy order (important)

1. **Set `AUTH_COOKIE_SECRET` in the Render dashboard first** (staging service → Environment → Add).
2. Then add the files / deploy the code.
3. Open the deploy log and confirm this line appears:
   `[auth-cookie] signed user_id cookies active (mode=enforce)`

If the code is deployed *without* the secret, the app deliberately refuses to start
(`AUTH_COOKIE_SECRET must be set…`). Render should then fail that deploy and keep the previous
version running, but set the variable first regardless.

## What users will notice

- **Everyone who is signed in on the environment is signed out once**, because their old
  cookie is the insecure format. They sign in again (magic link, Google, or password). Nothing
  about their accounts or data changes.
- Signing in and out otherwise behaves exactly as before.
- Any script, bookmark or tool that authenticated by hand-writing `user_id=<number>` will stop
  working. That is the point of the fix.

## Manual verification checklist (staging)

1. Sign in with **magic link** → you reach your workspace.
2. Sign out, sign in with **password** → works.
3. Sign out, sign in with **Google** → works. *(Not covered by automated tests — needs a human.)*
4. Refresh several pages (Dashboard, Settings, Interview) → you stay signed in.
5. Start an interview and speak one answer → voice works as before.
6. **Forgery check:** in Chrome open DevTools → Application → Cookies → your site → change the
   `user_id` value to `1` → refresh. You must be signed out (redirected to sign in).
7. Sign out → you land on the home page signed out; Back button does not reveal account pages.
8. As founder, open `/founder` → it loads. In a private window, `/founder` → sign-in page.

## Rollback

- **Fast, without redeploying code:** set `AUTH_COOKIE_MODE=transition` and restart the service.
  This makes the app accept old-format cookies again *(insecure — the original bug is back)*
  while still issuing signed ones. The log prints a warning on start and when a legacy cookie
  is accepted. Return to `enforce` as soon as the problem is fixed.
- **Full revert:** revert `server.js` (remove the one `app.use(require('./middleware/auth-cookie').fromEnv())`
  block). Cookies signed by this version will then not be recognised by the old code, so users sign in once more.
- There is deliberately **no automatic upgrade** of old cookies to signed ones: that would let a
  forged cookie be turned into a permanent signed credential.

## Secret rotation / emergency logout

Changing `AUTH_COOKIE_SECRET` and restarting invalidates every existing session at once.
Use it if the secret is ever exposed.

## Known limits (not addressed by this change)

- No per-user session revocation (for example "sign out everywhere" after a password change).
- Cookie lifetime stays 30 days, as before.
- No CSRF token layer; protection remains `SameSite=Lax` plus JSON-only write endpoints.
- `AUTH_COOKIE_MODE=transition` is not secure by design.

## Running the tests

```
node tests/auth-cookie-security.js
```

Needs no database or network access. Exit code 0 means everything passed.
