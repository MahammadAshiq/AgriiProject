# 🚀 Vercel Deployment Guide for AgriiLearn

This repository is pre-configured for one-click deployment to **Vercel** with GitHub integration. Both the frontend and Express backend (`/api/*`) are configured to run automatically.

---

## 1. Push to GitHub
Commit and push your project to your GitHub repository:
```bash
git add .
git commit -m "Configure AgriiLearn for production and Vercel deployment"
git push origin main
```

---

## 2. Import into Vercel
1. Go to [https://vercel.com](https://vercel.com) and log in.
2. Click **"Add New..."** -> **"Project"**.
3. Select your GitHub repository (`AgriiProject`).
4. **Framework Preset**: Choose **Other** (leave default).
5. **Root Directory**: `./` (leave default).

---

## 3. Configure Environment Variables in Vercel
Under the **Environment Variables** section in the Vercel project setup, add the following variables:

| Variable Name | Value / Description |
| :--- | :--- |
| `DATABASE_URL` | Your production PostgreSQL database connection string (from Neon, Supabase, Railway, or AWS RDS). Example: `postgres://username:password@ep-sample-123.us-east-2.aws.neon.tech/neondb?sslmode=require` |
| `JWT_SECRET` | A secure random string for JWT token generation (e.g. `agriilearn_prod_secret_2026_xyz`) |
| `SMTP_USER` | `agriiproject01@gmail.com` (Your Gmail address for sending welcome emails) |
| `SMTP_PASS` | `faew oqqg bzqn svys` (Your 16-character Google App Password) |

> [!TIP]
> If you need a free cloud PostgreSQL database for production, [Neon.tech](https://neon.tech) or [Supabase.com](https://supabase.com) provide instant, free PostgreSQL databases. Simply copy the `DATABASE_URL` into Vercel's Environment Variables.

---

## 4. Deploy & Verify
1. Click **"Deploy"**.
2. Once deployed, Vercel gives you your production URL (e.g. `https://agrilearn.vercel.app`).
3. You can verify your live account status API endpoint anytime:
   ```
   https://<your-vercel-domain>/api/account/status?email=agriiproject01@gmail.com
   ```
4. Every time you push changes to your GitHub `main` branch, Vercel will automatically build and re-deploy your project!
