# IMS System

Internal inventory management for PAFC retail: inbound purchasing from brands,
multi-location allocation, goods inwards/outwards, returns, and customer service.

## Stack
- React + Vite
- Supabase (auth + Postgres, RLS)
- Vercel (hosting + `/api` serverless functions)

## Local dev
```bash
npm install
cp .env.example .env   # fill in the anon key
npm run dev
```

## Database
Schema lives in `supabase/migrations`. Apply `0001_init.sql` via the Supabase
SQL editor (or the Supabase CLI).

## Deploy
Push to `main`; Vercel builds and deploys once the repo is linked to a Vercel
project. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel env vars.
