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
- [x] **Print-friendly member directory** — `/print` route renders a standalone page (callsign, name, class, phone, email, city/state, current-year dues tick). "Print Directory" button opens it in a new tab from the Members page.
- [x] **Year-over-year stats** — extend the Dashboard to compare this year's paid count and revenue against last year. One extra query, big context for the board.

### Longer-Term (Aligns with Roadmap)
- [ ] **Google Groups sync** — when a member is marked as paid for a given year, automatically add them to the corresponding Google Group (e.g. `members-2026@w4trc.org`). Requires a Google Workspace service account with domain-wide delegation and the Admin SDK Directory API. On payment: `POST /admin/directory/v1/groups/{groupKey}/members`. Should also handle removals if a membership is voided. Could be triggered from the same server-side code that records the payment.
- [x] **Phase 3 — Member portal + self-registration** — `/register` page (email token verification to claim existing records, or full self-registration for new members). Member portal shell (different nav/pages for `member` role): My Dashboard (dues status + payment instructions), My Profile (editable contact info, bio, interests, emergency contact, directory opt-in toggle), Membership History. Email sent via Resend — requires `RESEND_API_KEY` secret and `FROM_EMAIL` env var. Schema: `show_in_directory` on members, `portal_tokens` table (migration 011).
- [x] **Phase 4 — Public directory** — `/directory` page showing all members with `show_in_directory = 1`. Opt-in toggle on My Profile in member portal. No login required.
- [ ] **Phase 5 — Online dues payment** — Stripe Checkout integration. `POST /api/stripe/create-checkout` creates a hosted checkout session; `POST /api/stripe/webhook` handles `checkout.session.completed` and marks the member as paid. $21 individual / $31 family (includes $1 online processing fee). Schema: migration 013 adds `stripe_session_id` to memberships. Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
  - **Currently in sandbox (test mode).** Use Stripe test key (`sk_test_...`) and test card `4242 4242 4242 4242` to verify end-to-end before going live.
  - **To go live:** swap both secrets for live versions (`sk_live_...` + live webhook signing secret) — no code changes needed.
- [ ] **Phase 6 — Email reminders** — automated renewal notices via Cloudflare Email Workers or a transactional email provider (Mailgun, Resend). Triggered by a scheduled Worker cron.
- [x] weekly email roundups sent to board members, new members, online dues paid, total members 

### Operational / Nice-to-Have
- [ ] **Session list UI** — the `GET /api/admin/sessions` endpoint exists and returns active sessions, but there's no page for it in the UI yet. Useful for auditing who's logged in.
- [x] **ARRL membership tracking** — `is_arrl_member` field on members table (migration 004). Shows as ARRL badge in the members list, filterable by ARRL/non-ARRL, visible in member detail, editable in both add/edit forms, and counted in dashboard stats.
- [x] **Dark/light mode toggle** — the UI is dark-only right now. Not urgent, but some operators may prefer light mode.
