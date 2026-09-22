# Aqua Talent Service - Backend

Node.js/Express API for the Aqua Talent Service platform (student/company job matching, subscriptions, payments). Data lives in Supabase (Postgres); file uploads (logos, resumes, intro videos) live in Supabase Storage. The codebase is being incrementally converted from CommonJS JavaScript to TypeScript.

## Tech Stack

- Node.js, Express 5, TypeScript
- Supabase: Postgres (data) + Storage (files)
- JWT auth, bcrypt
- Razorpay (payments), Mailgun (email)

## Getting Started

### Prerequisites

- Node.js 18+
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm install -g supabase`)
- Access to the project's Supabase instance (ask a maintainer for the project ref, or create your own project for local development)

### Install

```bash
npm install
```

### Environment

```bash
cp .env.example .env
```

Fill in the values - see `.env.example` for the full list. Key groups:

- **Supabase** - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`. Used for both the Postgres client (`src/lib/supabase/client.ts`) and file storage (`src/services/mediaService.js`) - no separate storage credentials needed.
- **JWT** - `JWT_SECRET`.
- **Email** - `MAILGUN_*`.
- **Payments** - `RAZORPAY_*`.
- **MongoDB** - `MONGODB_URI` is only needed if you're running the one-time migration tooling in `scripts/supabase-migration/`; the running app never touches Mongo.

### Run

```bash
npm run dev     # nodemon, auto-reload
npm start        # plain node
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the API with nodemon |
| `npm start` | Start the API |
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run typecheck` | Type-check without emitting (`tsc --noEmit`) |
| `npm run supabase:migrate` | Apply pending SQL migrations to the linked Supabase project (`supabase db push`) |
| `npm run supabase:types` | Regenerate `src/lib/supabase/database.types.ts` from the linked project's schema |
| `npm run seed` | Run `supabase/seed.sql` against the linked project |

## Database (Supabase Postgres)

Schema changes are plain SQL files in `supabase/migrations/`, applied in filename order (timestamp-prefixed, e.g. `20260921000001_extensions.sql`).

### 1. Link the Supabase CLI to the project

```bash
supabase login
supabase link --project-ref <project-ref>
```

`<project-ref>` is the id in your Supabase project's URL (`https://<project-ref>.supabase.co`). This only needs to be done once per machine.

### 2. Check migration status

```bash
supabase migration list
```

Shows which migrations exist locally vs. which have already been applied to the linked project.

### 3. Apply pending migrations

```bash
npm run supabase:migrate
```

This runs `supabase db push`, which applies any migration in `supabase/migrations/` that hasn't been applied to the linked project yet, in order.

### 4. Add a new migration

```bash
supabase migration new <short_description>
```

This creates a new timestamped file under `supabase/migrations/`. Write plain SQL in it (see existing migrations for style/conventions), then run `npm run supabase:migrate` to apply it.

### 5. Seed data

```bash
npm run seed
```

Runs `supabase/seed.sql` against the linked project. Safe to re-run (uses `on conflict ... do nothing`).

### 6. Regenerate TypeScript types after a schema change

```bash
npm run supabase:types
```

Overwrites `src/lib/supabase/database.types.ts` from the linked project's current schema. Run this after any migration that changes tables/columns.

## File Storage

Three private Supabase Storage buckets - `company-logos`, `student-resumes`, `student-videos` - are created by `supabase/migrations/20260922000001_media_storage_bucket.sql`, with size/mime constraints matching the multer limits in `src/middleware/upload.ts`. Uploads and signed URLs go through `src/services/mediaService.js` using the same Supabase client as the database (no AWS/S3 credentials required).

## Legacy Mongo migration tooling

`scripts/supabase-migration/` contains the one-time backup/migrate/verify scripts used to move data from MongoDB to Supabase. They're not part of the running app and only need `MONGODB_URI` set if you ever need to re-run them.
