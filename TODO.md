# W4TRC Membership System — TODO

What's already built is described in [README.md](README.md). This file only lists open work.

---

## Finish What's Started

### Online dues payment (Stripe)
- [ ] **Go live** — built and tested in sandbox (test mode). Swap both secrets for the live versions (`sk_live_...` + live webhook signing secret); no code changes needed. Until then, use the test key (`sk_test_...`) and test card `4242 4242 4242 4242`.
- [ ] Run one family checkout end-to-end in Stripe test mode before relying on it.
- [ ] Clean up existing covered records (some 2026 ones show $20 due / "individual" type from the old form bug).

### Online donations
- [ ] Run one donation in Stripe test mode.
- [ ] Donation add-on at dues checkout ("add a donation to my renewal").
- [ ] Include online donations in the weekly board roundup.
- [ ] Run one donation from the public `/donate` page in Stripe test mode.

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
- [ ] **Google Groups** — create next year's group each September, before renewals open on October 1. `2026members@` is not synced; lower `GOOGLE_SYNC_START_YEAR` to bring it in.
- [ ] **Prospect outreach** — the local-ham list is already synced from HamDB. Add mailing labels and a "newly licensed in the area" section in the weekly roundup.
- [ ] **Officer and president history** — who held which position in which year, shown on the directory. The club has a full presidents history and knows some of the other officers, so the data model must allow partial years (president only) and unknown positions.
- [ ] **Membership card / certificate** — printable PDF from the portal once dues are paid.

### Under the Hood
- [ ] **More tests** — the Stripe webhook, dues-year logic, and family coverage are covered. Next: login and role checks on the admin routes.


---

## Not Doing
- Meeting self check-in (QR at the door)
- VE session → member pipeline
