# W4TRC Membership System — TODO

What's already built is described in [README.md](README.md). This file only lists open work.

---

## Finish What's Started

### Online dues payment (Stripe)
- [ ] **Go live** — built and tested in sandbox (test mode). Swap both secrets for the live versions (`sk_live_...` + live webhook signing secret); no code changes needed. Until then, use the test key (`sk_test_...`) and test card `4242 4242 4242 4242`.
- [ ] Run one family checkout end-to-end in Stripe test mode before relying on it.
- [ ] Clean up existing covered records (some 2026 ones show $20 due / "individual" type from the old form bug).

### Online donations
- [ ] Apply migration 019 to production **before** deploying, then run one donation in Stripe test mode.
- [ ] Donation add-on at dues checkout ("add a donation to my renewal").
- [ ] Include online donations in the weekly board roundup.
- [ ] Public donate page for non-members (no login).

---

## Ideas

### Money
- [ ] **Donation receipts** — year-end emailed receipt per donor (monetary and item donations), sent via Resend.
- [ ] **Treasurer report** — one page / CSV combining dues, donations, and payment method by year.

### Inventory
- [ ] **Loan due dates** — items can be checked out to a member, but there is no due date or overdue reminder.
- [ ] **QR labels** — printable label per item that opens its inventory page.
- [ ] **Asset value report** — total and per-location value from purchase price / estimated value, for insurance.

### Members & Outreach
- [ ] **Email reminders** — automated renewal notices to members. Not started; on hold for now. Resend and the daily cron are already in place, so this is a new email template plus a schedule (e.g. October, January, mid-March before the grace period ends). Should skip members covered under a family membership.
- [ ] **Google Groups sync** — when a member is marked as paid for a given year, automatically add them to the corresponding Google Group (e.g. `members-2026@w4trc.org`). Requires a Google Workspace service account with domain-wide delegation and the Admin SDK Directory API. On payment: `POST /admin/directory/v1/groups/{groupKey}/members`. Should also handle removals if a membership is voided. Could be triggered from the same server-side code that records the payment.
- [ ] **Prospect outreach** — the local-ham list is already synced from HamDB. Add mailing labels and a "newly licensed in the area" section in the weekly roundup.
- [ ] **Officer and president history** — who held which position in which year, shown on the directory. The club has a full presidents history and knows some of the other officers, so the data model must allow partial years (president only) and unknown positions.
- [ ] **Membership card / certificate** — printable PDF from the portal once dues are paid.

### Admin
- [ ] **Session list UI** — the `GET /api/admin/sessions` and `DELETE /api/admin/sessions/:id` endpoints exist, but there's no page for them in the UI yet. Useful for auditing who's logged in and revoking a session.

### Under the Hood
- [ ] **Tests and CI** — none today. Start with the Stripe webhook, dues-year logic, and family coverage.
- [ ] **Migration tracking** — the schema files are applied by hand one at a time; switch to `wrangler d1 migrations` so applied migrations are recorded.
- [ ] **Scheduled D1 backup to R2** — all member data lives in one database with no export of its own.

---

## Not Doing
- Meeting self check-in (QR at the door)
- VE session → member pipeline
