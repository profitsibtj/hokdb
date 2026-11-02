# HOK Database

The GitHub Pages app is a static site backed by Supabase Postgres and a password-protected Edge Function.

## Local development

1. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. Run `npm install`.
3. Run `npm run dev` and open the local URL printed by Vite.

## Build and preview

- `npm run lint` checks TypeScript.
- `npm run build:pages` builds the static site into `dist/`.
- `npm run preview` serves the production build locally.

See [redesign-preview/README.md](./redesign-preview/README.md) for Edge Function deployment, viewer/admin password setup, and publishing steps.

## Copyright

All data provided by Level Up Indonesia.
