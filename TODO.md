# W4TRC Membership System — TODO

What's already built is described in [README.md](README.md). This file only lists open work.

---

## Finish What's Started

### Online dues payment (Stripe)
- [ ] Run one family checkout end-to-end in Stripe test mode before relying on it.
- [ ] Clean up existing covered records (some 2026 ones show $20 due / "individual" type from the old form bug).

---

## Ideas

### Inventory
- [ ] **Loan due dates** — items can be checked out to a member, but there is no due date or overdue reminder.

### Members & Outreach
- [ ] **Certificate and card for members** — officers can print a membership certificate and card from a member's detail view. Let members print their own from the portal: buttons on the dues card for each paid year, and open `/print/certificate` and `/print/card` to a member for their own record.
- [ ] **Prospect outreach** — the local-ham list is synced from HamDB and new area licensees are added from the FCC daily. Add mailing labels.

### Under the Hood
- [ ] **More tests** — the Stripe webhook, dues-year logic, and family coverage are covered. Next: login and role checks on the admin routes.


---

## Not Doing
- Renewal reminders sent on a schedule (officers send them by hand from Dues → Renewal Reminders)
- Year-end donation receipts by email
- Meeting self check-in (QR at the door)
- VE session → member pipeline
