# HOK Database UI Preview

This folder contains the redesigned UI used by the main app through `src/main.tsx`. It also runs as a standalone sample preview; in that mode, you can optionally connect to Supabase in **read-only** mode to view live tournaments, schedules, matches, and rosters.

The concept is currently English-only, uses full-width horizontal navigation, and includes a dark theme and responsive, game-by-game match details. Game cards can be collapsed individually or controlled together with **Hide all games / Show all games**.

## Preview locally

From the repository root, run:

```powershell
python -m http.server 4174 --bind 127.0.0.1 --directory redesign-preview
```

Then open <http://127.0.0.1:4174/> in a browser. Use **Connect Supabase** in the top navigation to load live data.

Enter the project URL, its public anon/publishable key, and an invited Supabase email/password in the connection dialog. The key and short-lived session tokens stay in the current browser session; the password is not stored. Do not enter a `service_role` or secret key; the preview rejects the known secret-key formats. A successful connection replaces sample records with database records using the authenticated viewer role. The UI labels this as read-only; no insert, update, delete, or RPC write calls are made.

The redesign maps the existing `matches`, `schedules`, `roster`, and `tournaments` tables. It converts the existing nested `matches.games` JSON into the preview's game-by-game display and reads tournament settings from the `tournaments.data` JSON. Legacy `fearlessDraft` settings are shown as Global Ban & Pick for display only.

## Preview workflow

1. In **Tournaments**, create or rename an event, set BO1/BO3/BO5/BO7, optionally enable **Global Ban & Pick**, and add participating teams with manually entered abbreviations and qualification routes. When enabled, a team cannot pick a hero again after using it earlier in that series; the opposing team may still pick that hero.
2. In **Roster**, select the event and add each member with a role. Player registrations are scoped to that event/team. Duplicate nicknames can be distinguished with an identity note; Coach and Analyst are supported.
3. In **Matches**, choose an event and its participating teams, set the match to **Scheduled** or **Completed**, enter phase/stage, format, date/time, and a live-stream link. Scheduled matches preview their metadata without requiring game results. For completed matches, select the Blue-side team by clicking its button; the other team is Red.
4. For completed matches, enter each game's result, draft, objectives, rostered players, and stats. Each player's row follows **Role → Player → Hero** and includes one K/D/A field, Gold, Hero Damage, Damage Taken, KP, 1K–5K counts, MVP, and First Blood. The 1K–5K fields count that player's single-, double-, triple-, quadra-, and penta-kills for that game. A game MVP and First Blood player can each be selected once.
5. In sample mode, **Preview result** opens the per-game breakdown. Sample results also feed the preview's standings and player-stat calculations; nothing is persisted.

On the **Tournaments** page, open **How to add, edit, and delete tournaments or teams** for the step-by-step guide. Deleting participants or tournaments with match history is blocked to protect existing records. Tournament, participant, roster, and sample result changes exist only in browser memory and reset on reload.

Open a completed match's **Details** button to inspect the series score and per-game details. The centered scoreline keeps the two team names and game score grouped together. Use the per-game chevrons or **Hide all games / Show all games**.

The **Standings**, **Player stats**, **Roster**, **Head to head**, and **Achievements** sections show sample data. Head to head switches between team series and player-vs-player games. Standings use Game Diff instead of PTS. KP is calculated per game as `(kills + assists) / team kills`; the player leaderboard aggregates the same numerator and denominator across games. Gold, Hero Damage, and Damage Taken in the leaderboard are per-game averages.

## Files

- `index.html` - page structure and sample match content
- `styles.css` - visual design and responsive layout
- `app.js` - tournament, roster, match, stat, navigation, and authentication interactions

The standalone preview starts at a sample viewer password screen. Use `viewer-preview` to continue; **Add match** then asks for the separate demo admin password `admin-preview`. These demo values are visible in the preview source and are not real credentials. This browser-only gate is for reviewing the sample UI only. Its optional read-only Supabase connector uses Supabase Auth; the production website instead uses the shared-password Edge Function described below.

## Main app integration

The GitHub Pages build imports this UI and its styles from `src/main.tsx`. Production access uses separate shared viewer and admin passwords verified by the `hokdb-api` Supabase Edge Function. Passwords and the service-role key remain on Supabase; the browser receives a signed session that expires after eight hours. All production reads and writes go through that function, which rejects writes unless the session was issued with the admin password.

## Production setup

The database Auth migration may already be applied. Keep its restrictive RLS policies in place; the Edge Function accesses the tables with its server-only service role key. Do not add viewer/admin passwords to frontend environment variables or GitHub.

1. Install the Supabase CLI, sign in, and link it to the correct project:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```

2. In Supabase Dashboard, set these Edge Function secrets. The viewer and admin passwords must be different. The signing secret can be any non-empty value. Never paste these values into chat or commit them:

   - `VIEWER_PASSWORD`
   - `ADMIN_PASSWORD`
   - `SESSION_SIGNING_SECRET`

   Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Never expose the service-role key in the browser or GitHub Pages build.

3. Deploy the Edge Function from the repository root:

   ```powershell
   supabase functions deploy hokdb-api
   ```

4. Configure the GitHub Actions repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Settings → Secrets and variables → Actions**. These are the project URL and public anon/publishable key only. The scheduled keep-alive workflow reuses these values.

5. In GitHub, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Push to `main`/`master`, or start **Deploy GitHub Pages** manually from the Actions tab.

6. Verify both password roles on the deployed site: viewer password can read but cannot edit; admin password can read and edit. The sign-out button ends the browser session. Sessions expire after eight hours; changing a password prevents new logins but does not revoke already-issued sessions immediately. To revoke all current sessions, rotate `SESSION_SIGNING_SECRET`.

Supabase Auth accounts and `public.hokdb_admins` are not used by this password-only flow. The migration already run should remain in place; its policies keep direct anonymous table access closed.
