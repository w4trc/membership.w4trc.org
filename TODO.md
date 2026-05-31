# W4TRC Membership System — TODO

---

## From Our Conversations

These are things you've mentioned, noted, or that came up while building the system.

### In Progress
- [x] **Board role UI** — nav hides Admin section (User Accounts, Audit Log, Cutoff) for non-admin users. Board users get a full dashboard, Members, and Dues pages. Password change accessible via sidebar key button for all roles.

### Completed ✓
- [x] Family membership linking (`covered_by_member_id` on memberships, migration 003)
- [x] Payment details on membership creation (amount paid, method, date, check number inline with member add form)
- [x] Audit log with target names, callsigns, and membership years for better readability
- [x] Mobile sidebar with hamburger toggle and backdrop
- [x] Force-refresh on callsign lookup (`?force=true` param to bypass 7-day cache)
- [x] Background callsign sync after member record update

---

## Ideas Worth Considering

Things I'd suggest based on how the system is built and what a club like this typically needs.

### Near-Term (Low Effort, High Value)
- [x] **CSV/roster export** — a "Download CSV" button on the Members page. Useful for the club secretary, ARRL reporting, or emergency contact lists. Could filter by year, status, or membership type.
- [x] **License expiry warnings** — members whose FCC license expired in the last 90 days or expires within the next year get a dashboard widget. Color-coded by urgency.
- [x] **Upcoming renewals widget on Dashboard** — "Not Yet Renewed" card shows active members from the prior year with no current-year record. Includes grace period messaging through March 31.
- [x] **Keyboard shortcut to add member** — `/` focuses search, `N` opens the Add Member form (both members page only, no modal open). `Escape` closes any modal.

### Medium-Term
- [ ] **Batch mark-as-paid** — checkbox selection on the Dues page to mark multiple members paid at once (same method/date). Useful at a club meeting when 10 people pay cash in one sitting.
- [ ] **Renewal email drafts** — generate a mailto link or copy-to-clipboard draft for members with an email on file who haven't renewed. Not a full email system, just a "draft renewal notice" button per member or per year.
- [ ] **Print-friendly member directory** — a `/print` route or button that renders a clean, printable roster (name, callsign, class, phone) with no nav/chrome. Useful for paper handouts at meetings.
- [ ] **Year-over-year stats** — extend the Dashboard to compare this year's paid count and revenue against last year. One extra query, big context for the board.

### Longer-Term (Aligns with Roadmap)
- [ ] **Google Groups sync** — when a member is marked as paid for a given year, automatically add them to the corresponding Google Group (e.g. `members-2026@w4trc.org`). Requires a Google Workspace service account with domain-wide delegation and the Admin SDK Directory API. On payment: `POST /admin/directory/v1/groups/{groupKey}/members`. Should also handle removals if a membership is voided. Could be triggered from the same server-side code that records the payment.
- [ ] **Phase 3 — Member portal + self-registration** — public `/register` page where members enter their callsign or email; if found in the DB (from the spreadsheet import) they claim the record and set a password, otherwise they create a new record. After registering, show dues status and a payment link. Once registered, members can view their membership history, update contact info, and opt in/out of the directory. Needs a new `member` role flow in the UI (different nav, limited scope). Build this right before go-live so members can claim their imported records.
- [ ] **Phase 4 — Public directory** — opt-in public page at `/directory` showing callsign, license class, and interests. No login required. Members control visibility from their portal.
- [ ] **Phase 5 — Online dues payment** — PayPal or Stripe checkout link per member. Could be a simple hosted payment link rather than a full integration. Payment webhook marks the record as paid automatically.
- [ ] **Phase 6 — Email reminders** — automated renewal notices via Cloudflare Email Workers or a transactional email provider (Mailgun, Resend). Triggered by a scheduled Worker cron.

### Operational / Nice-to-Have
- [ ] **Session list UI** — the `GET /api/admin/sessions` endpoint exists and returns active sessions, but there's no page for it in the UI yet. Useful for auditing who's logged in.
- [ ] **Repeater access export** — if the club has a repeater with an access list, a filtered export (active members + callsign) could feed into that system directly.
- [x] **ARRL membership tracking** — `is_arrl_member` field on members table (migration 004). Shows as ARRL badge in the members list, filterable by ARRL/non-ARRL, visible in member detail, editable in both add/edit forms, and counted in dashboard stats.
- [ ] **Dark/light mode toggle** — the UI is dark-only right now. Not urgent, but some operators may prefer light mode.
