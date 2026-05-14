# KARC Membership System
**Kingsport Amateur Radio Club (W4TRC)**
`members.w4trc.org`

A Cloudflare Workers-based membership management system.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Rate Limiting | Cloudflare KV |
| Auth | Server-side sessions (PBKDF2 passwords) |
| Frontend | Single-page app served from Worker |
| Callsign API | HamDB (free, no key needed) |

---

## First-Time Deployment

### 1. Prerequisites

```bash
npm install -g wrangler
wrangler login
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
wrangler kv:namespace create RATE_LIMIT_KV
```

Paste the `id` into `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "PASTE_ID_HERE"   # ← paste here
```

### 4. Set secrets

```bash
# Generate a random 64-char string for JWT signing
wrangler secret put JWT_SECRET

# A one-time key you'll use to create your first admin account
wrangler secret put ADMIN_SETUP_KEY
```

For `ADMIN_SETUP_KEY`, pick something memorable — you'll need it in step 7.
For `JWT_SECRET`, use a random string: `openssl rand -hex 32`

### 5. Run the database schema

```bash
npm run db:init
```

### 6. Deploy the Worker

```bash
npm run deploy
```

### 7. Create your admin account

```bash
node scripts/setup-admin.js
```

Follow the prompts. This calls the `/api/setup` endpoint (which auto-disables
after the first admin account is created).

### 8. Configure DNS

In your Cloudflare DNS dashboard for `w4trc.org`:
- Add a CNAME record: `members` → your worker (wrangler handles this via the route in `wrangler.toml`)
- Or let wrangler set it up automatically when you deploy with the route configured.

---

## Local Development

```bash
# Initialize local D1
npm run db:init:local

# Start local dev server
npm run dev
# → http://localhost:8787
```

---

## Role System

| Role | Login | Add Members | Edit Members | Delete/Deactivate | Manage Users | Audit Log |
|---|---|---|---|---|---|---|
| `admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `board` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `member` | ✅ (future) | ❌ | Own profile | ❌ | ❌ | ❌ |

---

## Database Schema

```
users         → login accounts (email, password_hash, role)
members       → member records (callsign, name, address, license info)
memberships   → annual dues (year, status, amount_paid, payment_method)
notes         → admin/board log notes on members
audit_log     → security trail (every significant action)
sessions      → active login sessions
```

---

## API Routes

```
POST   /api/setup                     One-time admin setup
POST   /api/auth/login                Login
POST   /api/auth/logout               Logout
GET    /api/auth/me                   Current session info

GET    /api/members                   List/search members
POST   /api/members                   Create member (board+)
GET    /api/members/:id               Member detail + memberships + notes
PUT    /api/members/:id               Update member (board+)
DELETE /api/members/:id               Deactivate member (admin only)
GET    /api/members/:id/history       Membership year history

GET    /api/memberships               List memberships by year
POST   /api/memberships               Record payment (board+)
GET    /api/memberships/:id           Single membership record
PUT    /api/memberships/:id           Update payment record (board+)
GET    /api/memberships/stats         Stats (count, revenue) for a year

GET    /api/notes                     Notes for a member (board+)
POST   /api/notes                     Add note (board+)
PUT    /api/notes/:id                 Edit note (admin only)
DELETE /api/notes/:id                 Delete note (admin only)

GET    /api/lookup/:callsign          HamDB callsign lookup

GET    /api/admin/users               List user accounts (admin)
POST   /api/admin/users               Create user account (admin)
PUT    /api/admin/users/:id           Update user (admin)
DELETE /api/admin/users/:id           Delete user (admin)
POST   /api/admin/password            Change own password
GET    /api/admin/audit               Audit log (admin)
GET    /api/admin/sessions            Active sessions (admin)
GET    /api/admin/stats               Dashboard stats
```

---

## Membership Dues

| Type | Annual Fee |
|---|---|
| Individual | $20.00 |
| Family | $30.00 |

Payment methods tracked: `cash`, `check`, `paypal`, `other`

---

## Callsign Lookup

Uses the free **HamDB API** (`https://api.hamdb.org/v1/{call}/json`) to auto-fill:
- Name, address, city, state, ZIP
- License class (Technician, General, Amateur Extra, etc.)
- License expiry date and status

Callsign data is cached at the Cloudflare edge for 1 hour and automatically
re-synced in the background if data is older than 7 days.

---

## Roadmap / Future Phases

- **Phase 2**: Board member role (currently backend-ready, just needs UI)
- **Phase 3**: Member portal (members log in, view directory, edit their profile)
- **Phase 4**: Public directory (opt-in, shows callsign, class, interests)
- **Phase 5**: Online dues payment (PayPal, Stripe)
- **Phase 6**: Email reminders for expiring memberships

---

## Security Notes

- Passwords hashed with PBKDF2 (310,000 iterations, SHA-256)
- Sessions stored server-side in D1 (not JWT — no token theft risk)
- Rate limiting on login (10 attempts/15 min per IP)
- Full audit trail on all significant actions
- Admin-only endpoints protected at route level
- CORS locked to `members.w4trc.org` only
- `HttpOnly`, `Secure`, `SameSite=Strict` session cookies

---

## License
Internal use — Kingsport Amateur Radio Club (W4TRC)
