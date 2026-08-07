# AgriLearn Backend

A real Express + PostgreSQL backend: registration, OTP verification, role-specific
login, forgot password, and admin stats. Replaces the old `localStorage`-only
version — accounts now live in a real database, so logging in works from any
device.

## 1. Set up the database

You already have PostgreSQL 18 installed locally from the AgriProj setup. Just
create a new database and load the schema:

```bash
createdb agrilearn
psql -U postgres -d agrilearn -f schema.sql
```

## 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in:
- `DATABASE_URL` — your local Postgres connection string
- `JWT_SECRET` — any long random string
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — whatever you want to log into `/admin`
- `SMS_API_KEY` — **leave blank for now**. Without it, OTPs print to this
  server's console instead of being texted, so you can test the entire flow
  for free before paying for SMS. Sign up at fast2sms.com (or swap in Twilio/
  MSG91 in `utils/sms.js`) whenever you're ready to send real texts.

## 3. Install and run

```bash
npm install
npm start
```

You should see:
```
AgriLearn backend running on http://localhost:4000
```

## 4. Point the frontend at it

In `frontend/script.js`, `API_BASE_URL` is set to `http://localhost:4000/api`
by default — matches this setup out of the box for local testing.

## Going live (so it works from your phone, not just your laptop)

Right now this only runs on `localhost`, so only your own computer can reach
it. To make it real across devices, you'll need to:

1. **Host the backend** somewhere public — Render or Railway both have free
   tiers and work well for a small Node + Postgres app like this.
2. **Host the database** — either a cloud Postgres (Neon and Supabase both
   have free tiers), or Postgres running on whichever server you deploy the
   backend to.
3. **Update `API_BASE_URL`** in `script.js` to point at your deployed
   backend's URL instead of `localhost`.
4. **Get a real SMS API key** once you're ready to send actual texts.

None of this needs to happen today — everything works locally first, so you
can build and test the whole flow before spending anything on hosting or SMS
credits.

## Admin dashboard

Visit the "Admin Login" screen in the frontend, log in with the
`ADMIN_USERNAME`/`ADMIN_PASSWORD` from your `.env`, and you'll see real
registration counts and location breakdowns pulled straight from the
database — not fabricated numbers.
