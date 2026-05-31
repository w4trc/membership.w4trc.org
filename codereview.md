# Code Review — membership.w4trc.org

_Reviewed: 2026-05-31_

8 findings, ranked most severe first.

---

## 1. User enumeration via broken timing protection

**File:** [src/routes/auth.js:31](src/routes/auth.js#L31)
**Severity:** High (security)

The dummy hash used to equalize login timing for missing accounts is a bcrypt string (`$2b$12$dummyhashtopreventtimingattacks`), but `verifyPassword` expects PBKDF2/base64 and calls `atob()` first. `atob()` throws on `$` (not valid base64), the catch block returns `false` immediately with no PBKDF2 work done. Non-existent accounts respond measurably faster than real ones with wrong passwords, enabling account enumeration.

**Fix:** Replace the dummy with a valid stored hash produced at startup time by calling `hashPassword('dummy')`, or store a pre-computed valid PBKDF2 hash as a constant.

---

## 2. Family membership mis-recorded on Stripe payment

**File:** [src/routes/stripe.js:153](src/routes/stripe.js#L153)
**Severity:** High (data integrity)

The webhook's `INSERT` branch always hardcodes `membership_type = 'individual'` and `amount_due = 20.00`, regardless of whether the paying member is actually a family member. The Stripe checkout metadata only stores `member_id`, `year`, and `callsign` — not `membership_type` — so the webhook has no way to recover the correct type.

A family member who pays $31 online and has no prior membership row will be permanently recorded as an individual member with the wrong dues amount.

**Fix:** Look up the member's `membership_type` from the DB inside `handleCheckoutCompleted` before inserting. Also add `membership_type` to the Stripe metadata in `createCheckout` so it's available directly on the webhook event.

---

## 3. Session revoke never works

**File:** [src/routes/admin.js:28](src/routes/admin.js#L28)
**Severity:** Medium (broken functionality)

Session IDs are 64-character hex strings, but `parseInt(segments[4], 10)` is applied to the URL segment before passing it to `revokeSession`. For any hex-only string (e.g. `a3f1c2…`), `parseInt` returns `NaN`, which is falsy — the `method === 'DELETE' && resId` condition is never true, so the route returns 404 without touching the DB. For IDs that start with digits (e.g. `12abc…`), `parseInt` returns a truncated integer that matches no session.

**Fix:** Don't parse the session ID as an integer. Treat `segments[4]` as a string directly and pass it as-is to `revokeSession`.

---

## 4. Rate limiter `type` parameter silently ignored

**File:** [src/lib/rateLimit.js:16](src/lib/rateLimit.js#L16)
**Severity:** Medium (security)

`rateLimit(request, env, type)` accepts a `type` parameter but never uses it. The bucket key is always derived from the URL path (`url.pathname.includes('/auth/login') ? 'login' : 'api'`). Routes like `POST /api/auth/forgot-password` and `POST /api/portal/claim` are matched to the lax `api` bucket (120 req/min) instead of the stricter `login` bucket (10 per 15 min), making brute-force of 6-digit verification codes and email enumeration via password reset much easier.

**Fix:** Either use the `type` argument when passed, or extend the pathname-based logic to also match `/auth/forgot-password` and `/portal/claim` (and `/portal/request-token`) to the `login` bucket.

---

## 5. HamDB auto-fill silently broken on the registration page

**File:** [src/routes/portal.js:826](src/routes/portal.js#L826)
**Severity:** Medium (broken feature)

The public `/register` page's callsign auto-fill calls `fetch('/api/lookup/' + cs, { credentials: 'include' })` client-side. The `/api/lookup/` route in `index.js` sits behind the global `requireAuth` check, so unauthenticated users always receive 401. The `lookupCallsign` function checks `hamResp?.ok`, silently falls through on 401, and clears the hint text — no name or license class is ever pre-populated, despite the UI appearing to try.

**Fix:** Expose a public callsign lookup endpoint (e.g. `GET /api/portal/callsign-lookup/:cs`) that the registration page can call without a session, or proxy the HamDB lookup through the existing public `POST /api/portal/lookup` route.

---

## 6. Email uniqueness check misses unclaimed members

**File:** [src/routes/portal.js:353](src/routes/portal.js#L353)
**Severity:** Medium (security / account integrity)

`portalUpdateMe` checks email uniqueness against only the `users` table (`SELECT id FROM users WHERE email = ? AND id != ?`). A logged-in member can update their email to match the `members.email` of any member who hasn't yet claimed a portal account (no `users` row). After the update, `POST /api/portal/lookup` by email resolves to the wrong record, and the original member can no longer claim their account via email.

**Fix:** Also check `SELECT id FROM members WHERE email = ? COLLATE NOCASE AND id != ?` and reject if a different member record already holds that email.

---

## 7. Board email hardcoded in source code

**File:** [src/routes/admin.js:492](src/routes/admin.js#L492)
**Severity:** Low (operational / maintainability)

```js
const boardEmails = ['n4jhc@w4trc.org'];
```

A production email address is hardcoded in application source. Updating the recipient when a board member changes email or a new officer takes over requires a code change and redeployment.

**Fix:** Move to an environment variable (e.g. `BOARD_EMAILS` as a comma-separated string in `wrangler.toml` or a Worker secret) and split on `,` at runtime.

---

## 8. New Stripe sub-routes are unauthenticated by default

**File:** [src/index.js:96](src/index.js#L96)
**Severity:** Low (design / altitude)

The entire `/api/stripe/*` prefix bypasses the global `requireAuth` gate and relies on each sub-route inside `handleStripe` calling `requireAuth` internally. This works correctly today, but any future sub-route added to `handleStripe` (e.g. `/api/stripe/refund`) is publicly accessible by default unless the developer remembers to add an internal auth check.

**Fix:** Only exempt the specific public path from the global auth check:

```js
if (path === '/api/stripe/webhook' && method === 'POST') {
  return stripeWebhook(request, env);
}
// All other /api/stripe/* routes fall through to the requireAuth block below
```

This makes auth the default and explicit opt-out, rather than opt-in per sub-route.
