# KARC Membership System
**Kingsport Amateur Radio Club (W4TRC)**
`members.w4trc.org`

A Cloudflare Workers-based membership management system.

---

## Features

**For admins and board members**
- **Members** — add/edit records with HamDB callsign auto-fill, notes, family linking, ARRL / Eastman / silent key / lifetime honorary flags, filters, CSV export, and a print-friendly directory (`/print`)
- **Dues** — record payments per year (amount, method, date, check number); a family payment covers everyone linked under the payer
- **Renewal reminders** — an email to each member who has not paid for the year, with their amount and a link to pay online. An officer picks who gets one and presses Send; nothing goes out on a schedule (see [Renewal reminders](#renewal-reminders))
- **Dashboard** — paid counts and revenue with year-over-year comparison, charts, "not yet renewed" list, and license expiry warnings
- **Donations** — monetary and item donations from members, non-member individuals, organizations, or anonymous donors
- **Treasurer report** — the money received in a year: dues and donations by payment method, every payment listed, as a page, a printout, or a CSV
- **Officer history** — who was president, vice president, treasurer, secretary, and trustee each year, entered one at a time or pasted as a list, and shown on the public directory
- **Meeting attendance** — record meetings and who attended, by callsign (members, local hams, or HamDB lookup) plus guests
- **Meeting agendas** — officers plan each meeting ahead of time (officer reports, old and new business, announcements, presentation) and run it from the same page: Robert's Rules checklist, motions and votes, call-to-order and adjourn times. Open business carries over to the next agenda of the same kind; board meetings get a shorter checklist; the treasurer's slot shows dues and donations received since the last meeting; prints like the paper agenda
- **Equipment inventory** — items, storage locations, photos, purchase/donation info, move / check-out / note history, and printable QR labels (Avery 5160) that open the item when scanned
- **Repeaters** — each club repeater's listing (output and input frequencies, offset, access and repeater tones, mode, screen PIN behind a Show button, equipment, site and access directions), plus a visit log (who went, when, and why), reports of noise, interference, unlicensed use and outages with open / investigating / resolved status, maintenance and renewals (coordination, RepeaterBook and other listings, license, site lease) with next-due dates and a "coming due" list, site notes, site photos, and manuals and other files (uploaded or linked). See [Repeaters](#repeaters)
- **Local hams (prospects)** — outreach tracking for area hams who aren't members, synced from HamDB; new Church Hill, Kingsport, and Mount Carmel licensees are added automatically from the FCC, with a "New" badge and filter
- **Callsign report** — active member callsigns as a copyable list
- **Membership certificate and card** — printable by an officer for any member whose dues are paid
- **Terminal UI** — search members, inventory, and meetings from a terminal, record a meeting's attendance, and add, move, or check out equipment (`npm run tui`, see [Terminal UI](#terminal-ui))
- **Admin only** — user accounts, member password resets, audit log with filters, a list of active sessions with sign-out, the Google Groups sync and audit, and the annual membership cutoff

**For members**
- **Self-registration** (`/register`) — claim an existing record by email verification code, or sign up as a new member
- **Member portal** — dues status, profile (contact info, bio, interests, emergency contact), membership history
- **Online dues** and **online donations** through Stripe Checkout
- **Two-step sign-in** — optional for any login, officers especially: a 6-digit code from an authenticator app after the password (see [Two-step sign-in](#two-step-sign-in))
- **Public directory** (`/directory`) — opt-in, no login required; also lists the club's officers year by year
- **Public donate page** (`/donate`) — anyone can give through Stripe Checkout, no login required

**Automated**
- Weekly email roundup of new dues payments, online donations and newly added local hams to the board, plus repeater maintenance and renewals that are overdue or due in the next 60 days (Sunday evening cron)
- Daily check of the FCC's license files for new local licensees, added to Local Hams (see [New local licensees](#11-new-local-licensees))
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
| Mailing lists | Google Groups (optional, synced hourly) |
| Auth | Server-side sessions (PBKDF2 passwords) |
| Frontend | Single-page app: `src/ui.html` served by the Worker, `public/app.css` and `public/app.js` as static assets |
| Callsign API | HamDB (free, no key needed) |
| Email | Resend |
| Payments | Stripe Checkout |
| Error tracking | Sentry (no visitor IPs or cookies; 10% of requests traced) |
| Charts | Chart.js, a pinned copy in `public/vendor/` |

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
wrangler secret put STRIPE_TEST_SECRET_KEY # sk_test_... for the /demo renewal preview (optional)
wrangler secret put CRON_SECRET            # bearer token for the weekly roundup endpoint
wrangler secret put MCP_TOKEN              # bearer token for the /mcp endpoint used by AI agents (optional)
```

For `ADMIN_SETUP_KEY`, pick something memorable — you'll need it in step 8.
For `CRON_SECRET`, use a random string: `openssl rand -hex 32`

Non-secret settings (`CLUB_NAME`, `CLUB_CALLSIGN`, `CLUB_DOMAIN`, `FROM_EMAIL`, `CONTACT_EMAIL`) live under `[vars]` in `wrangler.toml`.

In Stripe, point a webhook at `https://members.w4trc.org/api/stripe/webhook` for the
`checkout.session.completed` event. Test and live mode each have their own key and
webhook secret; switching between them is only a matter of swapping the two secrets.

**Renewal demo.** `/demo` lets officers walk through a member renewal without logging in: the
portal shows a made-up member (N0CALL), and Pay Online opens a real Stripe Checkout page in test
mode (card `4242 4242 4242 4242`). Nothing is stored: the demo member exists only in the browser,
and the webhook ignores demo checkouts. The demo only ever uses a test key —
`STRIPE_TEST_SECRET_KEY`, or `STRIPE_SECRET_KEY` while that is still a test key — and is switched
off when neither is one.

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

### 10. The weekly roundup

The daily cleanup and backup, the hourly Google Groups sync and the weekly roundup email
all run inside the Worker (`[triggers]` in `wrangler.toml`). The roundup goes out Sunday at
23:00 UTC (7 PM Eastern in summer, 6 PM in winter) and covers the 7 days before it: dues payments,
online donations made that week (the /donate page and the member portal; ones entered by hand are left out), and
local hams the FCC check added that week. It sends nothing if all three are empty.

To send it on demand:

```bash
curl -X POST https://members.w4trc.org/api/admin/weekly-roundup \
  -H "Authorization: Bearer $CRON_SECRET"
```

### 11. New local licensees

Once a day (14:15 UTC, from the hourly cron) the Worker downloads the FCC's daily amateur
license files for the previous two days (`l_am_mon.zip` ... `l_am_sun.zip` from
`data.fcc.gov/download/pub/uls/daily/`). Any individual with an active license and an address
in Church Hill, Kingsport, or Mount Carmel, TN is handled like this:

- **Not on the list** — added to Local Hams as *Not Contacted*, marked *New license*,
  *New callsign*, or *New to the area*
- **Already on the list** — address and license details refreshed; outreach status and notes are kept
- **New callsign for someone on the list** — their row moves to the new callsign
- **Already a member** — added or refreshed the same way, and shown as a member
- **Member with a new callsign** — their member record gets the new callsign (only when the
  last name matches, since old callsigns get reissued), logged in the audit log

Hams on the list whose address moves out of the area, or whose license here expires or is
cancelled, are marked *Moved away*, *License expired*, or *License cancelled*. They are left out of
the outreach counts and filters and shown under *No Longer Local*. The mark clears if they show
up active in the area again.

Each file is read once; the FCC replaces it weekly. On the Local Hams page, the *New (30 days)*
tile and the *New this week / 30 / 90 days* filter show the new ones, and an admin can press
**Check FCC now** to read the whole past week. The cities are set by `AREA_CITIES` in
`src/lib/fccLicensees.js`.

The daily files only show licenses that changed recently. To catch up on everyone already
licensed in the area, run the backfill from your computer (Node 22.12+). It downloads the
FCC's full database (about 200 MB) and writes `scripts/prospects-backfill.sql`:

```bash
npm run db:backfill:prospects
```

Then add them to the live database (run `npm run db:migrate` first if you haven't since
migration 024):

```bash
npm run db:backfill:prospects:apply
```

It gives members and hams on the list their new callsign if they changed it, adds hams not
already on the list (members included), and marks hams on the list who are no longer local —
anyone not active in the area cities. Outreach details are kept, so it is safe to run again
later to catch up. They show on Local Hams as *Caught up from FCC* (filter *All added from FCC*) and are
left out of the weekly roundup. If the download is slow, download `l_amat.zip` from the FCC
yourself and pass it in with `npm run db:backfill:prospects -- --zip path/to/l_amat.zip`.

---

## Local Development

```bash
# Build the local D1 database (applies every migration not yet applied)
npm run db:migrate:local

# (Optional) seed sample logins and records (see seeds/dev_admin.sql for the
# logins and their password), and the local-ham list
npm run db:seed:local
npm run db:seed:prospects:local

# Start local dev server
npm run dev
# → http://localhost:8787
```

The admin section and member portal are one page: `src/ui.html` is the page
itself, `public/app.css` its styles and `public/app.js` its script. They are
plain files with no build step, and `npm run deploy` uploads them with the Worker.

Put local secrets in `.dev.vars`. `npm run import-members` loads members from a CSV
(`scripts/import-members.js`), and `bruno/` holds a Bruno API collection.

### Terminal UI

`npm run tui` opens a terminal UI for looking up members, equipment, and meeting
attendance. It can also record a new meeting, add an inventory item, and move, check out, or add a note to an
inventory item; those are the only things it writes. It signs in with your normal admin or board account and uses the same API as the web
app, so there is nothing to deploy. It has no dependencies beyond Node 18.14+ and runs
in Windows Terminal, PowerShell, and macOS or Linux terminals.

```bash
npm run tui               # members.w4trc.org
npm run tui -- --local    # wrangler dev at http://localhost:8787
npm run tui -- --logout   # sign out and forget the saved session
```

Type to search. `Tab` switches between members, inventory, and meetings, `↑` `↓` move,
`Enter` opens a record, `Ctrl+F` cycles the filter, `Esc` clears the search or goes back,
and `Ctrl+C` quits.

`Ctrl+N` starts a new meeting from the members or meetings tab. The date defaults to today and the type to Monthly, so
you can type callsigns straight away, separated by spaces; each one is looked up
(members, then local hams, then HamDB) and listed as you go. Guests without a callsign
go in the Guests field, separated by commas. `Ctrl+S` saves. To edit or delete a
meeting, use the web app.

On the inventory tab, `Ctrl+N` adds a new item instead: name, maker, model, serial
number, and where it is kept (type to filter the locations and members). `Ctrl+S` saves.
Purchase details and photos are added in the web app.

With an inventory item open, `m` moves it or checks it out (type to filter the
locations and members, `↑` `↓` to choose) and `n` adds a dated note; `Ctrl+S` saves.

On the members tab, the **Unpaid this year** filter lists active members with no paid
or exempt dues record for the current year, by the same rule as the annual cutoff.

Copying to the clipboard: `Ctrl+E` copies the email addresses and `Ctrl+L` the callsigns
of everyone in the current member list (all pages, comma-separated), so filtering to
Unpaid this year and pressing `Ctrl+E` gives a renewal-reminder mailing list. With a
record open, `e`, `c`, and `p` copy a member's email, callsign, or phone, and `c` copies
an item's serial number or a meeting's callsigns.

The session id is saved in `~/.karc-tui.json` so you stay signed in
until the session expires.

To use it on a machine without the repo, download the one file and run it with Node.
After that it updates itself: it shows a notice when a newer version is on GitHub, and
`--update` replaces the file in place.

```bash
curl -O https://raw.githubusercontent.com/w4trc/membership.w4trc.org/main/scripts/tui.js
node tui.js
node tui.js --update      # fetch the latest version
```

Inside a checkout of this repo, `git pull` updates it instead.

### Tests

```bash
npm test            # run once
npm run test:watch  # re-run on change
```

Tests live in `test/` and run with Vitest inside the Workers runtime, against a throwaway D1
database built from the migrations in `schema/`. They cover the Stripe webhook and checkout,
the dues-year rules, family coverage, sessions, the database backup, the treasurer
report, the officer history, the membership certificate and card, and the Google Groups sync and audit. Nothing leaves the machine: Stripe is mocked and no
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

## Google Groups

Optional. Each year has its own Google Group — `2026members@w4trc.org`, `2027members@w4trc.org`,
and so on (the pattern is `GOOGLE_GROUP_FORMAT` in `wrangler.toml`). Every hour the Worker adds
that year's current members to the group: anyone who has paid, is covered by a paid family
membership, is paid for by Eastman, is honorary or waived for the year, or is a lifetime honorary
member. From October 1 it also fills next year's group as people renew.

- Members with no email on file are skipped. A shared family address is added once.
- If a payment is voided or a member's email changes, the old address is removed — but **only
  if the sync added it**. Anyone you add to a group by hand in Google is never removed.
- Groups are **not** created automatically. Create next year's group before October 1; until it
  exists the sync reports an error for that year and changes nothing.
- A run makes at most 35 changes, so the first sync of a full group takes a few runs.
- Addresses in `GOOGLE_GROUP_ALWAYS_ADD` in `wrangler.toml` (comma-separated) are added to
  every synced group whether or not they belong to a member. Taking one out of the setting
  removes it from the groups on the next run.
- `GOOGLE_SYNC_START_YEAR` in `wrangler.toml` is the first year the sync manages. Groups for
  earlier years are never contacted. It is set to `2027`, so `2026members@` is left alone;
  lower it (and deploy) to bring an earlier year in.

The **Google Groups** page under Admin shows what is waiting to be added or removed for each
year, and has a **Sync Now** button. Until the key below is set, the page works as a preview
and nothing is sent to Google.

### Audit

**Audit Groups** on the same page reads each group from Google and sets it against the
membership list, address by address. For each year it shows:

- everyone who should be in the group, with the member each address belongs to, and whether
  Google has it. Anyone **missing** is flagged and listed first.
- every address in the group that does not belong to a current member, with the name of any
  lapsed member it matches and the Google role of owners and managers.
- current members with no email on file.

Addresses on the club's own domain (`@w4trc.org`) are disregarded: officers are in each group
with their club email so they can manage it, so those are counted but never listed as not
belonging to a current member.

The audit changes nothing in Google or in the database. It covers this year's group, and next
year's from October 1, including years before `GOOGLE_SYNC_START_YEAR` — so it can check
`2026members@` even though the sync leaves that group alone.

The sync works from its own record of what it has added, not from the group itself. If an
address it added is later removed in Google, or the person leaves the group, the sync does not
add it back; the audit is how you find those.

### Setup

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (or pick
   one), enable the **Admin SDK API**, create a **service account**, and download a **JSON key**
   for it.
2. Let the service account manage group members. In the Google Workspace Admin console go to
   **Account → Admin roles → Groups Admin → Assign service accounts** and enter the service
   account's email address.
3. Store the key as a secret, then delete the downloaded file:

   ```bash
   # bash
   wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY < path/to/key.json

   # PowerShell
   Get-Content path\to\key.json -Raw | wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY
   ```

4. Create this year's group in Google (for example `2026members@w4trc.org`).
5. Open **Google Groups** under Admin and press **Sync Now**.

If you would rather use domain-wide delegation than an admin role, skip step 2: authorize the
service account's client ID for the scope
`https://www.googleapis.com/auth/admin.directory.group.member` under **Security → API controls →
Domain-wide delegation**, and set `GOOGLE_ADMIN_EMAIL` (a `[vars]` entry) to a Workspace admin
for the sync to act as.

---

## Role System

| Role | Login | Add Members | Edit Members | Delete/Deactivate | Manage Users | Audit Log |
|---|---|---|---|---|---|---|
| `admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `board` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `member` | ✅ (portal) | ❌ | Own profile | ❌ | ❌ | ❌ |

Board users also get donations, meeting attendance and agendas, inventory, repeaters, and local hams. Deleting
a donation, meeting, inventory item, repeater, or note is admin only.

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
google_group_members   → addresses the Google Groups sync has placed in each year's group
officers               → who held which position in which year
repeaters              → club repeaters: frequencies, tones, screen PIN, equipment, site
repeater_visits        → site visits (date, times, who, why); always for the whole site
repeater_reports       → reports of trouble on a repeater, with status and resolution
repeater_maintenance   → maintenance done and renewals kept up, with next-due dates
repeater_notes         → site notes (no repeater_id: the whole site)
repeater_contacts      → people to call, and who has a key (no repeater_id: the whole site)
repeater_photos        → site photos + thumbnails (no repeater_id: the whole site)
repeater_documents     → manuals and files (uploaded to R2, or a link)
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
- `020_google_group_sync.sql` — record of addresses synced to each year's Google Group
- `021_public_donations.sql` — `individual` donor type, `donor_name` and `donor_email` on donations
- `022_officers.sql` — officer history
- `023_prospects_fcc.sql` — FCC auto-add fields on prospects, `fcc_daily_imports` table
- `025_agendas.sql` — meeting agendas: checklist ticks, officer reports, business items, motions
- `026_agenda_quorum.sql` — voting member count fixed when a meeting adjourns
- `027_repeaters.sql` — repeaters, their visits, reports, maintenance, notes, photos, and documents
- `028_repeater_site.sql` — notes and photos for the whole repeater site (nullable `repeater_id`)
- `029_repeater_contacts.sql` — repeater and site contacts
- `030_repeater_visits_site.sql` — visits belong to the whole site; existing visits move there
- `031_repeater_control_freq.sql` — control frequency on repeaters
- `032_two_step.sql` — two-step sign-in columns on `users` (key, recovery code hashes, wrong-code lock)
- `033_renewal_reminders.sql` — record of the renewal reminder emails officers have sent

---

## Pages

```
/                 Admin / board app and member portal (single-page app)
/register         Member self-registration (public)
/directory        Public member directory (opt-in members only) and officer history
/donate           Public donation form (no login)
/print            Print-friendly member directory (login required)
/print/treasurer  Print-friendly treasurer report, ?year=YYYY (board+)
/print/certificate  Membership certificate, ?member_id=N&year=YYYY (board+)
/print/card       Membership card, ?member_id=N&year=YYYY (board+)
/print/agenda     Meeting agenda and checklist, ?id=N (board+)
/print/labels     Equipment QR labels for Avery 5160 sheets, ?ids=1,2,3 (default all) &skip=N (board+)
/i/:id            Where a label's QR code points: the item in the inventory for signed-in officers, otherwise a public "found this?" page with the club's CONTACT_EMAIL
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
GET    /api/auth/two-step             Whether two-step sign-in is on for your login
POST   /api/auth/two-step/setup       Start setup: { password } → a key and its QR code
POST   /api/auth/two-step/enable      Turn it on: { code } → recovery codes, shown once
POST   /api/auth/two-step/disable     Turn it off: { password, code }

GET    /api/officers                  Officer history, newest year first (board+)
POST   /api/officers                  Add an officer (board+)
POST   /api/officers/bulk             Add a pasted list for one position (board+)
PUT    /api/officers/:id              Update an officer (board+)
DELETE /api/officers/:id              Remove an officer (board+)

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

GET    /api/reminders                 Who would get a renewal reminder, and who is left out and why (?year, board+)
POST   /api/reminders/preview         The reminder email as it will look: { year, note } (board+)
POST   /api/reminders/test            Send one copy to your own login address (board+)
POST   /api/reminders/send            Send to { year, member_ids, note } (board+)

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
DELETE /api/meetings/:id              Delete a meeting and its agenda (admin only)
GET    /api/agendas                   List agendas with their meetings (board+, ?year)
POST   /api/agendas                   Start an agenda (uses or creates the meeting; carries open business)
GET    /api/agendas/:id               Whole agenda: checklist, reports, items, motions, attendance, income
PATCH  /api/agendas/:id               Change agenda fields (only the fields sent)
DELETE /api/agendas/:id               Delete an agenda; the meeting stays (admin only)
POST   /api/agendas/:id/checks        Tick or untick a checklist step
PUT    /api/agendas/:id/reports/:key  Save an officer report
POST   /api/agendas/:id/carry         Pull in open business from the previous agenda
POST   /api/agendas/:id/items         Add business or an announcement (PATCH/DELETE /items/:itemId)
POST   /api/agendas/:id/motions       Record a motion (PATCH/DELETE /motions/:motionId)

GET    /api/repeaters                 Repeaters with open reports, last visit, and what is coming due (board+)
POST   /api/repeaters                 Add a repeater
GET    /api/repeaters/:id             One repeater with visits, reports, maintenance, notes, photos, documents
PATCH  /api/repeaters/:id             Change repeater fields (only the fields sent)
DELETE /api/repeaters/:id             Delete a repeater and everything on it (admin only)
POST   /api/repeaters/:id/reports     Log a report (PATCH/DELETE /reports/:entryId)
POST   /api/repeaters/:id/maintenance Log maintenance or a renewal (PATCH/DELETE /maintenance/:entryId)
POST   /api/repeaters/:id/notes       Add a site note (PATCH/DELETE /notes/:entryId; PATCH { site_wide } moves it)
POST   /api/repeaters/:id/contacts    Add a contact { name, title, phone, email, has_key, notes } (same as notes)
POST   /api/repeaters/:id/photos      Add a photo { image, thumb, caption, taken_date } (GET/PATCH/DELETE /photos/:photoId)
GET    /api/repeaters/site            Visits, contacts, notes, and photos for the whole site
POST   /api/repeaters/site/visits     Log a site visit (PATCH/DELETE /site/visits/:entryId; also /site/contacts, /site/notes, /site/photos)
POST   /api/repeaters/:id/documents   JSON { title, kind, url } adds a link; any other body uploads a file
                                      (?title=&kind=&filename=, up to 25 MB) (GET/PATCH/DELETE /documents/:docId)

GET    /api/prospects                 List local hams with member cross-reference (board+)
GET    /api/prospects/stats           Outreach summary counts
PUT    /api/prospects/:id             Update outreach status / postcard / notes
GET    /api/prospects/fcc             When each FCC daily file was last checked
POST   /api/prospects/fcc?day=mon     Check one FCC daily file now (admin; ?force=1 re-reads it)

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
POST   /api/stripe/create-public-donation-checkout  Start an online donation from /donate (public)
POST   /api/stripe/webhook                   Stripe webhook (records dues and donations)
POST   /api/demo/checkout                    Start a test-mode checkout for the /demo renewal (public, nothing stored)

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
GET    /api/admin/treasurer-report    Money received in a year (board+; ?year=YYYY, ?format=csv)
POST   /api/admin/password            Change own password (any role)
GET    /api/admin/users               List user accounts (admin)
POST   /api/admin/users               Create user account (admin)
PUT    /api/admin/users/:id           Update user (admin)
DELETE /api/admin/users/:id           Delete user (admin)
POST   /api/admin/users/:id/reset-password  Send a user a password reset link (admin)
DELETE /api/admin/users/:id/two-step  Turn off two-step sign-in for a user who lost their phone (admin)
GET    /api/admin/audit               Audit log (admin)
GET    /api/admin/sessions            Active sessions (admin)
DELETE /api/admin/sessions/:ref       Revoke a session, by the id from the list (admin)
POST   /api/admin/cutoff              Deactivate members who haven't renewed (admin, dry run by default)
POST   /api/admin/sync-hamdb          Bulk sync member license data from HamDB (admin)
POST   /api/admin/sync-prospects      Bulk sync local hams from HamDB (admin)
POST   /api/admin/backup              Back up the database to R2 now (admin)
GET    /api/admin/google-sync         What the Google Groups sync would change (admin)
POST   /api/admin/google-sync         Run the Google Groups sync now (admin)
GET    /api/admin/google-audit        Compare each Google Group with the membership list (admin)
POST   /api/admin/weekly-roundup      Send the weekly board email (CRON_SECRET, no session)
POST   /mcp                           MCP server for AI agents (MCP_TOKEN, no session; see below)
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

### Renewal reminders

**Dues & Memberships → Renewal Reminders** (`/admin/reminders`, board and admin) lists the members
who have not paid for the dues year: everyone still on the roll (active, or in good standing the
year before) with no paid or exempt record for it. The year is next year during renewal season
and this year otherwise, and can be switched.

An officer ticks who gets one, can add a line of their own, can look at the email or send a test
copy to themselves, and presses **Send**. **Nothing is sent on a schedule**: there is no cron for
reminders. Each member gets one email with their amount ($20 or $30) and a button to the portal;
replies go to `CONTACT_EMAIL`.

Left out, and listed with the reason: members covered under someone else's family membership
(the payer gets the reminder), Eastman members, and members with no usable email address.
Silent keys and lifetime honorary members never appear. Someone reminded in the last 14 days is
listed but not ticked, and a second press of Send within 10 minutes does not email anyone twice.

Each email sent is recorded (`renewal_reminders`) and shown as **Last Reminded**; the send is in
the audit log. Emails go through Resend's batch endpoint, so a send is one request per 100
members. Resend's free plan allows 100 emails a day: if a send runs into that, the page lists who
did not get theirs and they can be sent the next day.

---

## Membership Certificate and Card

Board members and admins can print a **membership certificate** (one landscape letter page)
and a **membership card** (credit-card size, with a dashed line to cut along) for any member in
good standing. Both open as a page with a **Print / Save as PDF** button. Members cannot print
their own yet.

- The **Certificate** and **Card** links are under Membership in a member's detail view, one
  pair for each year the member is paid up. During renewal season someone who has renewed has
  them for both this year and next.
- They are only available for a year the member is in good standing: paid, covered by a paid
  family membership, paid for by Eastman, honorary or waived for the year, or lifetime honorary.
  This is the same rule the Google Groups sync uses. Until then the page says dues are not yet
  recorded.
- The certificate has signature lines for the **President** and **Secretary**. If that year's
  officers are in the [officer history](#officer-history), their names are printed under the
  lines; otherwise the lines are left blank.
- "Member since" comes from the member's joined date and is left off if there isn't one.

Print the card at 100% scale, not "fit to page", so it comes out the right size.

---

## Officer History

**Officers** in the sidebar (board and admin) is a table with a row for each year and a column
for each position: President, Vice President, Treasurer, Secretary, and Trustee. Click a name
to change or remove it, or a **+** to fill a gap.

- **A year needs only what you know.** A year with just a president is fine; unknown positions
  stay empty.
- **Officers do not have to be members.** Anyone can be entered by name. If the callsign matches
  a member record, the entry is linked to it, and the name can be left blank to use the one on
  file.
- **Two people can share a position in a year**, for someone who took over part-way through.
  The notes field is for details like "took over in June"; notes are not shown publicly.
- Years run from 1900 to next year, so newly elected officers can be entered before January.

**Paste a List** adds many years at once for one position, which is the quick way to enter the
list of past presidents. Put one officer on each line: the year, the name, and the callsign if
there is one.

```
1985 John Smith W4ABC
1986-1988 Mary Jones, K4XYZ
1989 Bob Brown
```

A range of years adds an entry for each year. Anyone already listed is skipped, so a list can be
pasted again after a correction. If any line cannot be read, nothing is added and the lines at
fault are shown.

The whole history is shown at the bottom of the public directory (`/directory`), newest year
first. Unlike the member list above it, this is not opt-in: every officer entered is public.
To add a position, add it to `POSITIONS` in `src/lib/officers.js`.

---

## Treasurer Report

**Treasurer Report** in the sidebar (board and admin) shows the money the club received in one
calendar year. Pick a year at the top; **Print** opens a one-page version to print or save as a
PDF, and **Export CSV** downloads every payment as a row.

- **Money is counted in the year it arrived**, so the totals match the bank account. Dues go by
  paid date, not by the year they are for: a 2027 renewal paid in October 2026 is 2026 money.
  "Dues by membership year" shows how the year's dues split between this year's memberships,
  renewals paid in advance, and late payments. Donations go by donation date.
- **By payment method** totals dues and donations for cash, check, PayPal, Stripe, and so on.
  A payment recorded with no method is listed as "Unspecified".
- **Payments** lists every dues payment and money donation behind the totals, oldest first.
- **Item donations** are listed with their estimated value but are not counted as money.
- **Eastman** is shown as a note, not in the totals: the number of members Eastman sponsors for
  the year, at $3 each. If you record Eastman's payment as a donation it is counted then.
- A dues payment with no paid date is counted in the year the dues are for, and the report says
  how many there are.

Online payments are shown as charged, including the $1 processing fee; Stripe's own fees are
not taken off. In the CSV, the reference for an online payment is its Stripe session ID.

---

## Callsign Lookup

Uses the free **HamDB API** (`https://api.hamdb.org/v1/{call}/json`) to auto-fill:
- Name, address, city, state, ZIP
- License class (Technician, General, Amateur Extra, etc.)
- License expiry date and status

Callsign data is cached at the Cloudflare edge for 1 hour and automatically
re-synced in the background if data is older than 7 days.

---

## Repeaters

The **Repeaters** tab (board+) keeps everything about the club's repeaters in one place. The
list shows each machine's output frequency, input and offset, tone, site, and open
reports, with a **Coming Due** box on top for maintenance and renewals that are overdue or due
in the next 60 days. The same list goes out in the Sunday roundup email every week until each
item is logged done. Each repeater has these tabs:

- **Info** — the listing (output = what the repeater transmits, input = what users transmit,
  offset worked out from the two, access tone users send and any tone the repeater sends out,
  and the control frequency its control receiver listens on),
  callsign, band, mode, power, digital settings, screen PIN (hidden until **Show** is clicked),
  equipment, antenna, site, address (with a map link), and access directions
- **Contacts** — who to call: name, title (landowner, tower climber, trustee, ...), phone and
  email (tap to call or write), whether they have a key to the site, and notes
- **Reports** — noise, interference, unlicensed use, kerchunking, conduct, outages, audio, and
  coverage reports, each open, investigating, or resolved. Resolving one dates it today unless
  another date is given
- **Visit Log** — date, arrive and leave times, who went, why, and what was done. Visits are
  for the whole site (one trip, whichever repeaters were worked on), so every repeater and the
  Repeater Site page show the same log
- **Maintenance & Renewals** — work done and paperwork kept up (coordination, listing renewals,
  license, site lease, insurance). Give an entry a next-due date to see it in Coming Due. The
  latest entry with the same type and title is the one that counts, so logging a renewal again
  replaces the old due date; **Mark Done** does that for you, keeping the same interval
- **Site Notes** — dated notes, which can be pinned to the top. Notes are written in Markdown
  (headings, bold and italic, lists and `- [ ]` checklists, links, code, quotes) with a preview
  while typing; HTML in a note is shown as text, and links may only be web, email, or phone links
- **Photos** — shrunk in the browser and stored in D1 like inventory photos, so they're in the
  daily backup

Contacts, notes, and photos can be for the **whole site** instead of one repeater (the default, since the
club has one site). Site-wide ones show on every repeater's Contacts, Site Notes, and Photos tabs with a
**Site** badge, and on the **Repeater Site** page reached from the top of the Repeaters list.
Editing a contact, note, or photo from a repeater page moves it between that repeater and the site.
- **Manuals & Files** — upload a file (PDF, programming file, license, ...) up to 25 MB, or add
  a link. Uploads are stored in R2 under `repeaters/` in the `karc-membership-backups` bucket,
  next to (but not part of) the database backups, so no new bucket is needed. PDFs, pictures,
  and plain text open in the browser; anything else downloads

The screen PIN and control frequency are never written to the audit log (only that they
changed), and the MCP tools leave them out, since either would let someone take over a repeater.

---

## AI Agent Access (MCP)

`POST /mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server, so an AI
agent (such as Hermes) can look up club data and do a few board tasks. It uses the Streamable
HTTP transport, stateless, with plain JSON responses.

**What the agent can do.** Read members, dues, donations, the treasurer report, dashboard stats,
meetings, officers, inventory, repeaters (without screen PINs or control frequencies), and local hams; look up callsigns.
It can also add notes to a member, record meeting attendance, add items to meeting agendas, and
log reports against a repeater (`add_note`, `record_meeting`, `add_meeting_attendees`,
`add_agenda_item`, `add_repeater_report`).
It cannot edit or delete members, dues, donations, inventory, or repeater settings, or manage users. The tool list
is in `src/routes/mcp.js`.

**How it's secured.** Requests need `Authorization: Bearer <MCP_TOKEN>`. Each call runs as the
login account in `MCP_USER_EMAIL` (`wrangler.toml`), always with board permissions even if
that account is an admin, and goes through the same API handlers as the web app. Notes show
that account as the author, and every write lands in the audit log with a `mcp (...)` user agent.

### Setup

1. In **Admin → Users**, create a login account with the email in `MCP_USER_EMAIL`
   (`hermes@w4trc.org` by default) and the **board** role. Give it a long random password;
   nobody logs in with it.
2. Create the token and deploy:
   ```powershell
   wrangler secret put MCP_TOKEN    # paste a random string, e.g. from: openssl rand -hex 32
   npm run deploy
   ```
3. Point the agent at it. For Hermes, in `~/.hermes/config.yaml`:
   ```yaml
   mcp_servers:
     w4trc:
       url: "https://members.w4trc.org/mcp"
       headers:
         Authorization: "Bearer <MCP_TOKEN>"
   ```
   Then run `/reload-mcp` in Hermes (or restart it) to pick up the tools.

To cut the agent off, deactivate that login account or change `MCP_TOKEN`.

---

## Security Notes

- Passwords hashed with PBKDF2 (100,000 iterations, SHA-256)
- Sessions stored server-side in D1 (not JWT — no token theft risk); 30 days for admin and board, 8 hours for members
- Rate limiting on login, password reset, and portal verification (10 attempts/15 min per IP), and 40 per 15 min on the other forms that need no login (registration, member lookup, callsign lookup). Ordinary page loads are not counted, which keeps the limiter inside the free plan's daily KV writes
- Optional two-step sign-in (TOTP) for any login; see below
- Full audit trail on all significant actions
- Members can call only their portal, online payment and password change; every other API area is checked for an officer login in one place (`mayCallApi` in `src/lib/auth.js`), so a new route is closed to members by default
- Admin-only endpoints protected at route level
- CORS locked to `members.w4trc.org` only
- `HttpOnly`, `Secure`, `SameSite=Strict` session cookies
- Stripe webhook requests are signature-verified
- The `/mcp` agent endpoint needs a bearer token and is capped at board permissions with a fixed set of tools

### Two-step sign-in

Any login can turn it on from the **Password** button in the sidebar: scan a QR code with an
authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…), type the
code it shows, and save the eight recovery codes. From then on signing in asks for the password
and then a 6-digit code. It is worth having on every admin and board login, since those can read
every member's phone and email.

- Standard TOTP (RFC 6238: SHA-1, 6 digits, 30 seconds), checked one step either side of now for a phone clock that is a little off. Each code works once.
- Five wrong codes in a row lock the second step for 15 minutes, whatever address they come from, on top of the per-address login limit.
- A recovery code signs in once in place of the app. Only their hashes are stored. Turning two-step sign-in off and on again makes new ones.
- Turning it on signs that login out everywhere else. Turning it off needs the password and a code.
- A password reset by email does not turn it off.
- **Lost phone and recovery codes:** an admin opens User Accounts → Edit → **Turn Off 2-Step**. The user is signed out and signs back in with their password alone. If the only admin is the one locked out, clear it in the database: `wrangler d1 execute karc-membership --remote --command "UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_recovery = NULL WHERE email = 'you@example.com'"`.
- The key is stored in the `users` table as authenticator apps need it, so it is in the R2 backups too. Keep the backup bucket private.

---

## License
Internal use — Kingsport Amateur Radio Club (W4TRC)
