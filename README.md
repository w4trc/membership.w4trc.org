# KARC Membership System
**Kingsport Amateur Radio Club (W4TRC)**
`members.w4trc.org`

A Cloudflare Workers-based membership management system.

---

## Features

**For admins and board members**
- **Members** — add/edit records with HamDB callsign auto-fill, notes, family linking, ARRL / Eastman / silent key / lifetime honorary flags, filters, CSV export, and a print-friendly directory (`/print`)
- **Dues** — record payments per year (amount, method, date, check number); a family payment covers everyone linked under the payer
- **Dashboard** — paid counts and revenue with year-over-year comparison, charts, "not yet renewed" list, and license expiry warnings
- **Donations** — monetary and item donations from members, organizations, or anonymous donors
- **Meeting attendance** — record meetings and who attended, by callsign (members, local hams, or HamDB lookup) plus guests
- **Equipment inventory** — items, storage locations, photos, purchase/donation info, and move / check-out / note history
- **Local hams (prospects)** — outreach tracking for area hams who aren't members, synced from HamDB
- **Callsign report** — active member callsigns as a copyable list
- **Admin only** — user accounts, member password resets, audit log with filters, and the annual membership cutoff

**For members**
- **Self-registration** (`/register`) — claim an existing record by email verification code, or sign up as a new member
- **Member portal** — dues status, profile (contact info, bio, interests, emergency contact), membership history
- **Online dues** and **online donations** through Stripe Checkout
- **Public directory** (`/directory`) — opt-in, no login required

**Automated**
- Weekly email roundup of new dues payments to the board
- Daily cron: expired session cleanup, and January reactivation of members who renewed in advance
- `/health` endpoint for uptime monitoring
- Dark / light theme, mobile sidebar, keyboard shortcuts (`/` search, `N` add member, `Esc` close)

Open work is tracked in [TODO.md](TODO.md).

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Rate Limiting | Cloudflare KV |
| Backups | Cloudflare R2 (daily SQL file) |
| Auth | Server-side sessions (PBKDF2 passwords) |
| Frontend | Single-page app served from Worker |
| Callsign API | HamDB (free, no key needed) |
| Email | Resend |
| Payments | Stripe Checkout |
| Error tracking | Sentry |

---

## First-Time Deployment

### 1. Prerequisites

```bash
npm install
npx wrangler login
```

### 2. Create the D1 database

```bash
wrangler d1 create karc-membership
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "karc-membership"
database_id = "PASTE_ID_HERE"   # ← paste here
```

### 3. Create the KV namespace (for rate limiting)

```bash
wrangler kv namespace create RATE_LIMIT_KV
```

Paste the `id` into `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "PASTE_ID_HERE"   # ← paste here
```

Then create the R2 bucket that holds the daily database backup. The name must match
`bucket_name` under `[[r2_buckets]]` in `wrangler.toml`:

```bash
wrangler r2 bucket create karc-membership-backups
```

### 4. Set secrets

```bash
wrangler secret put ADMIN_SETUP_KEY        # one-time key for creating the first admin account
wrangler secret put RESEND_API_KEY         # outgoing email (verification codes, password resets, roundup)
wrangler secret put STRIPE_SECRET_KEY      # sk_test_... or sk_live_...
wrangler secret put STRIPE_WEBHOOK_SECRET  # whsec_... for the /api/stripe/webhook endpoint
wrangler secret put CRON_SECRET            # bearer token for the weekly roundup endpoint
```

For `ADMIN_SETUP_KEY`, pick something memorable — you'll need it in step 8.
For `CRON_SECRET`, use a random string: `openssl rand -hex 32`

Non-secret settings (`CLUB_NAME`, `CLUB_CALLSIGN`, `CLUB_DOMAIN`, `FROM_EMAIL`) live under `[vars]` in `wrangler.toml`.

In Stripe, point a webhook at `https://members.w4trc.org/api/stripe/webhook` for the
`checkout.session.completed` event. Test and live mode each have their own key and
webhook secret; switching between them is only a matter of swapping the two secrets.

### 5. Create a `.env` file

The deploy and db scripts use `dotenv-cli` to pass your Cloudflare account credentials:

```
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
```

### 6. Run the database schema

```bash
npm run db:migrate
```

This applies every migration in `schema/` that the database does not have yet, in order,
and records each one in the `d1_migrations` table. When upgrading, run it again **before**
deploying the code that needs the new migrations. `npm run db:migrate:list` shows what is
still waiting to be applied.

Optionally load the local-ham list (FCC export for the Kingsport area):

```bash
npm run db:seed:prospects
```

> **Database set up before migrations were tracked?** Run `npm run db:baseline` once. It marks
> migrations 001–019 as already applied without running them again. Only do this on a database
> that really has all of them.

### 7. Deploy the Worker

```bash
npm run deploy
```

### 8. Create your admin account

```bash
npm run setup-admin
```

Follow the prompts. This calls the `/api/setup` endpoint (which auto-disables
after the first admin account is created).

### 9. Configure DNS

In your Cloudflare DNS dashboard for `w4trc.org`:
- Add a CNAME record: `members` → your worker (wrangler handles this via the route in `wrangler.toml`)
- Or let wrangler set it up automatically when you deploy with the route configured.

### 10. Schedule the weekly roundup

The daily cleanup and backup cron runs inside the Worker (`[triggers]` in `wrangler.toml`). The weekly
roundup email does not — an outside scheduler has to call it:

```bash
curl -X POST https://members.w4trc.org/api/admin/weekly-roundup \
  -H "Authorization: Bearer $CRON_SECRET"
```

It sends nothing if no dues were recorded in the last 7 days.

---

## Local Development

```bash
# Build the local D1 database (applies every migration not yet applied)
npm run db:migrate:local

# (Optional) seed with a sample admin and the local-ham list
npm run db:seed:local
npm run db:seed:prospects:local

# Start local dev server
npm run dev
# → http://localhost:8787
```

Put local secrets in `.dev.vars`. `npm run import-members` loads members from a CSV
(`scripts/import-members.js`), and `bruno/` holds a Bruno API collection.

### Tests

```bash
npm test            # run once
npm run test:watch  # re-run on change
```

Tests live in `test/` and run with Vitest inside the Workers runtime, against a throwaway D1
database built from the migrations in `schema/`. They cover the Stripe webhook and checkout,
the dues-year rules, family coverage, and the database backup. Nothing leaves the machine: Stripe is mocked and no
secrets are needed. GitHub Actions runs them, plus a build check, on every push and pull
request (`.github/workflows/ci.yml`).

### Adding a migration

```bash
npm run db:migrate:new -- add_something   # creates the next numbered file in schema/
npm run db:migrate:local                  # try it locally
npm test                                  # tests rebuild the database from schema/
npm run db:migrate                        # apply to production, then deploy
```

Never edit a migration that has been applied to production — add a new one instead.

---

## Backups

The daily cron (8:00 UTC) writes the whole database to the `karc-membership-backups` R2 bucket
as a SQL file:

```
daily/karc-membership-YYYY-MM-DD.sql    kept for 30 days
monthly/karc-membership-YYYY-MM.sql     first backup of each month, kept for 12 months
```

Login sessions, password reset tokens, and portal verification codes are left out, so a copy
of a backup cannot be used to sign in as someone. Everything else is included, photos too.
The bucket is private; treat the files like the database itself.

An admin can take a backup at any time with `POST /api/admin/backup`.

`/health` reports the backup too. It answers `503` with `"backup": "stale"` when there is no
backup for today or yesterday (UTC), so an uptime monitor notices within a day or so of the
backups stopping. That includes a fresh install before its first backup — take one by hand
after the first deploy. Failures are also logged as `backupDatabase failed` (`wrangler tail`).

The backup is built to fit the Workers free plan (10 ms CPU, 50 subrequests per run), which is
why the file is not compressed. It will outgrow those limits as the database grows; `/health`
going stale is the sign, and moving to a paid plan or exporting with `wrangler d1 export` from
outside the Worker are the ways out.

### Restoring

A backup loads into a **new, empty** database — it will not load over the existing one.

```bash
# 1. Download a backup
wrangler r2 object get karc-membership-backups/daily/karc-membership-2026-10-12.sql   --remote --file backup.sql

# 2. Create a new database, and put its name and id in wrangler.toml
wrangler d1 create karc-membership-restored

# 3. Load the backup into it
wrangler d1 execute karc-membership-restored --remote --file backup.sql

# 4. Deploy, so the Worker uses the new database
npm run deploy
```

Everyone has to log in again afterwards. The restored database keeps its migration history,
so `npm run db:migrate` carries on from where the backup left off.

To undo a recent mistake, D1 Time Travel (`wrangler d1 time-travel restore`) is quicker and
rewinds the live database in place. The R2 backups are for when the database itself is lost.

---

## Role System

| Role | Login | Add Members | Edit Members | Delete/Deactivate | Manage Users | Audit Log |
|---|---|---|---|---|---|---|
| `admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `board` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `member` | ✅ (portal) | ❌ | Own profile | ❌ | ❌ | ❌ |

Board users also get donations, meeting attendance, inventory, and local hams. Deleting
a donation, meeting, inventory item, or note is admin only.

Admin and board users whose login is linked to a member record land on the member portal
like everyone else (so they can pay their own dues and donate online), with an **Admin
Section** button in the sidebar; **My Membership** in the admin sidebar switches back.
An officer login with no linked member record goes straight to the admin section.

---

## Database Schema

```
users                  → login accounts (email, password_hash, role, member_id)
members                → member records (callsign, name, address, license info, flags,
                         show_in_directory)
memberships            → annual dues (year, status, amount_paid, payment_method,
                         stripe_session_id, covered_by_member_id for family linking)
notes                  → admin/board log notes on members
audit_log              → security trail (every significant action)
sessions               → active login sessions
portal_tokens          → email verification codes for portal registration
password_reset_tokens  → password reset links
prospects              → local hams who aren't members, with outreach status
donations              → monetary and item donations
meetings               → meetings (date, type)
meeting_attendees      → who attended each meeting
inventory_items        → club equipment
inventory_locations    → where equipment is stored
inventory_photos       → item photo + thumbnail
inventory_events       → item move / check-out / note history
```

Schema migrations in `schema/` (seed data lives in `seeds/` and is not a migration):
- `001_initial.sql` — base schema
- `003_family_linking.sql` — adds `covered_by_member_id` to memberships
- `004_arrl_member.sql` — ARRL member flag
- `005_callsign_mismatch.sql` — flags members whose record disagrees with HamDB
- `006_silent_key.sql` — silent key flag
- `007_lifetime_honorary.sql` — lifetime honorary membership type
- `008_prospects.sql` — local hams (prospects) table
- `010_prospects_hamdb.sql` — address and license fields on prospects
- `011_portal.sql` — `show_in_directory` on members, `portal_tokens` table
- `012_password_reset.sql` — password reset tokens
- `013_stripe.sql` — `stripe` payment method and `stripe_session_id` on memberships
- `014_eastman_member.sql` — Eastman member flag and `eastman` payment method
- `015_donations.sql` — donations table
- `016_attendance.sql` — meetings and attendees
- `017_inventory.sql` — equipment inventory (items, locations, photos, move/note history)
- `018_inventory_purchase.sql` — inventory purchase date, price, source, and donated flag
- `019_donation_stripe.sql` — links online donations to their Stripe Checkout session

---

## Pages

```
/                 Admin / board app and member portal (single-page app)
/register         Member self-registration (public)
/directory        Public member directory (opt-in members only)
/print            Print-friendly member directory (login required)
/health           Uptime check — 200 if the Worker and D1 are reachable and the backup is current, 503 if not
```

---

## API Routes

```
POST   /api/setup                     One-time admin setup
POST   /api/auth/login                Login
POST   /api/auth/logout               Logout
GET    /api/auth/me                   Current session info
POST   /api/auth/forgot-password      Email a password reset link
POST   /api/auth/reset-password       Set a new password from a reset link

GET    /api/members                   List/search members
POST   /api/members                   Create member (board+)
GET    /api/members/export            CSV roster export (board+)
GET    /api/members/:id               Member detail + memberships + notes
PUT    /api/members/:id               Update member (board+)
DELETE /api/members/:id               Deactivate member (admin only)
GET    /api/members/:id/history       Membership year history
POST   /api/members/:id/resolve-callsign  Resolve a HamDB callsign mismatch (board+)

GET    /api/memberships               List memberships by year
POST   /api/memberships               Record payment (board+)
GET    /api/memberships/:id           Single membership record
PUT    /api/memberships/:id           Update payment record (board+)
GET    /api/memberships/stats         Stats (count, revenue) for a year

GET    /api/notes                     Notes for a member (board+)
POST   /api/notes                     Add note (board+)
PUT    /api/notes/:id                 Edit note (admin only)
DELETE /api/notes/:id                 Delete note (admin only)

GET    /api/lookup/:callsign          HamDB callsign lookup (?force=1 to re-sync now)

GET    /api/donations                 List donations (?member_id, ?year, ?kind)
POST   /api/donations                 Record a donation (board+)
GET    /api/donations/:id             Single donation
PUT    /api/donations/:id             Update a donation (board+)
DELETE /api/donations/:id             Delete a donation (admin only)
GET    /api/donations/stats           Donation totals

GET    /api/meetings                  List meetings with attendee counts (board+, ?year)
POST   /api/meetings                  Record a meeting and its attendees
POST   /api/meetings/resolve          Look up callsigns without saving
GET    /api/meetings/:id              Meeting with attendee list
PUT    /api/meetings/:id              Update a meeting; replaces its attendee list
DELETE /api/meetings/:id              Delete a meeting (admin only)

GET    /api/prospects                 List local hams with member cross-reference (board+)
GET    /api/prospects/stats           Outreach summary counts
PUT    /api/prospects/:id             Update outreach status / postcard / notes

POST   /api/portal/lookup             Find a member record to claim (public)
POST   /api/portal/request-token      Email a verification code (public)
POST   /api/portal/claim              Claim an existing record with a code (public)
POST   /api/portal/register           Register as a new member (public)
GET    /api/portal/directory          Public directory data (public)
GET    /api/portal/callsign-lookup/:callsign  HamDB lookup for the register form (public)
GET    /api/portal/me                 The logged-in member's record and dues status
PUT    /api/portal/me                 Update own profile
GET    /api/portal/history            Own membership history
GET    /api/portal/donations          The logged-in member's own donations
PUT    /api/portal/directory-opt-in   Show/hide self in the public directory

POST   /api/stripe/create-checkout           Start online dues payment (member)
POST   /api/stripe/create-donation-checkout  Start an online donation (member)
POST   /api/stripe/webhook                   Stripe webhook (records dues and donations)

GET    /api/inventory                 List/search equipment (board+)
POST   /api/inventory                 Add item (board+)
GET    /api/inventory/:id             Item detail + move/note history
PUT    /api/inventory/:id             Update item details
DELETE /api/inventory/:id             Delete item (admin only)
POST   /api/inventory/:id/move        Move to a location or check out to a member
POST   /api/inventory/:id/notes       Add a dated note
GET    /api/inventory/:id/photo       Item photo (?size=thumb)
PUT    /api/inventory/:id/photo       Upload photo
DELETE /api/inventory/:id/photo       Remove photo
GET    /api/inventory/meta            Locations + members for dropdowns
POST   /api/inventory/locations       Add a storage location

GET    /api/admin/stats               Dashboard stats (board+)
GET    /api/admin/charts              Dashboard chart data (board+)
GET    /api/admin/callsigns           Active member callsign report (board+)
POST   /api/admin/password            Change own password (any role)
GET    /api/admin/users               List user accounts (admin)
POST   /api/admin/users               Create user account (admin)
PUT    /api/admin/users/:id           Update user (admin)
DELETE /api/admin/users/:id           Delete user (admin)
POST   /api/admin/users/:id/reset-password  Send a user a password reset link (admin)
GET    /api/admin/audit               Audit log (admin)
GET    /api/admin/sessions            Active sessions (admin)
DELETE /api/admin/sessions/:id        Revoke a session (admin)
POST   /api/admin/cutoff              Deactivate members who haven't renewed (admin, dry run by default)
POST   /api/admin/sync-hamdb          Bulk sync member license data from HamDB (admin)
POST   /api/admin/sync-prospects      Bulk sync local hams from HamDB (admin)
POST   /api/admin/backup              Back up the database to R2 now (admin)
POST   /api/admin/weekly-roundup      Send the weekly board email (CRON_SECRET, no session)
```

---

## Membership Dues

| Type | Annual Fee | Paid Online |
|---|---|---|
| Individual | $20.00 | $21.00 |
| Family | $30.00 | $31.00 |

Online payments include a $1 processing fee.

Payment methods tracked: `cash`, `check`, `paypal`, `stripe`, `eastman`, `other`

Renewal season opens October 1: from then through December 31, online payments apply to
the following year. A lapsed member who renews in that window is reactivated on January 1.

Family members can be linked via `covered_by_member_id` — the secondary member's
dues record points to the primary (paying) member's ID. This shows on the member
detail, dues list, and audit log. When the payer pays family dues online, everyone
linked under them is marked covered for that year, and the link carries forward from
each dependent's most recent dues record. Covered members see "Covered by a Family
Membership" in the portal instead of a pay button.

---

## Callsign Lookup

Uses the free **HamDB API** (`https://api.hamdb.org/v1/{call}/json`) to auto-fill:
- Name, address, city, state, ZIP
- License class (Technician, General, Amateur Extra, etc.)
- License expiry date and status

Callsign data is cached at the Cloudflare edge for 1 hour and automatically
re-synced in the background if data is older than 7 days.

---

## Security Notes

- Passwords hashed with PBKDF2 (100,000 iterations, SHA-256)
- Sessions stored server-side in D1 (not JWT — no token theft risk); 30 days for admin and board, 8 hours for members
- Rate limiting on login, password reset, and portal verification (10 attempts/15 min per IP); 120 requests/min on the rest of the auth and portal API
- Full audit trail on all significant actions
- Admin-only endpoints protected at route level
- CORS locked to `members.w4trc.org` only
- `HttpOnly`, `Secure`, `SameSite=Strict` session cookies
- Stripe webhook requests are signature-verified

---

## License
Internal use — Kingsport Amateur Radio Club (W4TRC)
