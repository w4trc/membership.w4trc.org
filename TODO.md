# W4TRC Membership System — TODO

What's already built is described in [README.md](README.md). This file only lists open work.

---

## Finish What's Started

### Online dues payment (Stripe)
- [ ] **Go live** — built and tested in sandbox (test mode). Swap both secrets for the live versions (`sk_live_...` + live webhook signing secret); no code changes needed. Until then, use the test key (`sk_test_...`) and test card `4242 4242 4242 4242`.
- [ ] Run one family checkout end-to-end in Stripe test mode before relying on it.
- [ ] Before going live, add `STRIPE_TEST_SECRET_KEY` (the current `sk_test_...` key) so the `/demo` renewal keeps working on sandbox.
- [ ] Clean up existing covered records (some 2026 ones show $20 due / "individual" type from the old form bug).

### Online donations
- [X] Run one donation from the public `/donate` page in Stripe test mode.

---

## Ideas

### Money
- [ ] **Donation receipts** — year-end emailed receipt per donor (monetary and item donations), sent via Resend.

### Inventory
- [ ] **Loan due dates** — items can be checked out to a member, but there is no due date or overdue reminder.

### Members & Outreach
- [ ] **Certificate and card for members** — officers can print a membership certificate and card from a member's detail view. Let members print their own from the portal: buttons on the dues card for each paid year, and open `/print/certificate` and `/print/card` to a member for their own record.
- [ ] **Email reminders** — automated renewal notices to members. Not started; on hold for now. Resend and the daily cron are already in place, so this is a new email template plus a schedule (e.g. October, January, mid-March before the grace period ends). Should skip members covered under a family membership.
- [ ] **Prospect outreach** — the local-ham list is already synced from HamDB. Add mailing labels and a "newly licensed in the area" section in the weekly roundup.

### Under the Hood
- [ ] **More tests** — the Stripe webhook, dues-year logic, and family coverage are covered. Next: login and role checks on the admin routes.


---

## Not Doing
- Meeting self check-in (QR at the door)
- VE session → member pipeline
