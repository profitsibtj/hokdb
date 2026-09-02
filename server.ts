import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { getSupabase } from "./src/supabaseClient.ts";
import {
  mapMatchFromDb, mapMatchToDb, mapRosterFromDb, mapRosterToDb,
  mapScheduleFromDb, mapScheduleToDb, mapLeaguePresetFromDb, formatMatchData, sortMatches
} from "./src/dbMappers.ts";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Credentials loaded dynamically from environment
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;
const ACTION_PASSWORD = process.env.ACTION_PASSWORD;

if (!ACCESS_PASSWORD || !ACTION_PASSWORD) {
  console.warn("⚠️ WARNING: ACCESS_PASSWORD and/or ACTION_PASSWORD are not set in environment variables!");
}

// Auth middleware for internal API calls
const checkAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Unauthorized: Missing Authorization Header" });
    return;
  }
  const token = authHeader.replace("Bearer ", "");
  const isValidAccess = !!ACCESS_PASSWORD && token === ACCESS_PASSWORD;
  if (!isValidAccess) {
    res.status(401).json({ error: "Unauthorized: Invalid Password" });
    return;
  }
  next();
};

// Auth middleware for administrative actions
const checkAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  const queryToken = req.query.password as string;
  const headerToken = req.headers["x-password"] as string;
  const bodyToken = req.body?.password as string;

  const token = (authHeader ? authHeader.replace("Bearer ", "") : "") || queryToken || headerToken || bodyToken;

  if (!token) {
    res.status(401).json({ error: "Unauthorized: Missing Authorization Password" });
    return;
  }
  const isValidAdmin = (!!ACTION_PASSWORD && token === ACTION_PASSWORD) || (!!ACCESS_PASSWORD && token === ACCESS_PASSWORD);
  if (!isValidAdmin) {
    res.status(401).json({ error: "Unauthorized: Invalid Action Password. Access restricted." });
    return;
  }
  next();
};

// Auth Endpoint
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (!!ACCESS_PASSWORD && password === ACCESS_PASSWORD) {
    res.json({ success: true, token: password });
  } else {
    res.status(401).json({ success: false, error: "Incorrect password! Please try again." });
  }
});

// Action Verification Endpoint
app.post("/api/verify-action", (req, res) => {
  const { password } = req.body;
  if ((!!ACTION_PASSWORD && password === ACTION_PASSWORD) || (!!ACCESS_PASSWORD && password === ACCESS_PASSWORD)) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: "Incorrect password! Only admins with the action password are authorized for this." });
  }
});

// Match Endpoints
app.get("/api/matches", checkAuth, async (_req, res) => {
  try {
    const { data: rawMatches, error } = await getSupabase().from("matches").select("*");
    if (error) {
      if (error.code === "PGRST205" || error.message?.includes("relation \"matches\" does not exist")) {
        return res.status(409).json({
          error: "DATABASE_SETUP_NEEDED",
          message: "The 'matches' table has not been created in your Supabase database yet."
        });
      }
      throw error;
    }
    const formatted = (rawMatches || []).map((m) => mapMatchFromDb(m));
    res.json(sortMatches(formatted.map((m) => formatMatchData(m))));
  } catch (error: any) {
    console.error("Error in GET /api/matches:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/matches", checkAdminAuth, async (req, res) => {
  try {
    const dbObj: any = mapMatchToDb(formatMatchData(req.body));
    dbObj.created_at = new Date().toISOString();
    const { data, error } = await getSupabase().from("matches").insert([dbObj]).select("id").single();
    if (error) throw error;

    res.json({ success: true, id: String(data.id) });
  } catch (error: any) {
    console.error("Error in POST /api/matches:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/matches/:id", checkAdminAuth, async (req, res) => {
  try {
    const dbObj: any = mapMatchToDb(formatMatchData(req.body));
    dbObj.updated_at = new Date().toISOString();
    const { error } = await getSupabase().from("matches").update(dbObj).eq("id", req.params.id);
    if (error) throw error;

    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error("Error in PUT /api/matches:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/matches/:id", checkAdminAuth, async (req, res) => {
  try {
    const { error } = await getSupabase().from("matches").delete().eq("id", req.params.id);
    if (error) throw error;
    // Reclaim the ID if it was the highest one, so the next insert reuses it instead of leaving
    // a permanent gap. Best-effort: an old database without this SQL function shouldn't fail the delete.
    try {
      await getSupabase().rpc("reset_matches_id_seq");
    } catch (e) {}
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error in DELETE /api/matches:", error);
    res.status(500).json({ error: error.message });
  }
});

// Roster Endpoints
app.get("/api/roster", async (_req, res) => {
  try {
    const { data: rawRoster, error } = await getSupabase().from("roster").select("*");
    if (error) {
      if (error.code === "PGRST205" || error.message?.includes("relation \"roster\" does not exist")) {
        return res.status(409).json({
          error: "DATABASE_SETUP_NEEDED",
          message: "The 'roster' table has not been created in your Supabase database yet."
        });
      }
      throw error;
    }

    res.json((rawRoster || []).map((r) => mapRosterFromDb(r)));
  } catch (error: any) {
    console.error("Error in GET /api/roster:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/roster", async (req, res) => {
  try {
    const { password, player } = req.body;
    const isValidAdmin = (!!ACTION_PASSWORD && password === ACTION_PASSWORD) || (!!ACCESS_PASSWORD && password === ACCESS_PASSWORD);
    if (!isValidAdmin) {
      return res.status(401).json({ error: "Incorrect password! Only admins can edit the roster." });
    }

    if (player.id) {
      const dbObj: any = mapRosterToDb(player);
      dbObj.updated_at = new Date().toISOString();
      const { error } = await getSupabase().from("roster").update(dbObj).eq("id", player.id);
      if (error) throw error;

      res.json({ success: true, id: player.id });
    } else {
      const dbObj: any = mapRosterToDb(player);
      dbObj.created_at = new Date().toISOString();
      const { data: inserted, error } = await getSupabase().from("roster").insert([dbObj]).select("id").single();
      if (error) throw error;

      res.json({ success: true, id: String(inserted.id) });
    }
  } catch (error: any) {
    console.error("Error in POST /api/roster:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/roster/:id", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const authPass = authHeader ? authHeader.replace("Bearer ", "") : "";
    const reqPassword = req.body.password || req.query.password || req.headers["x-password"] || authPass;

    const isValidAdmin = (!!ACTION_PASSWORD && reqPassword === ACTION_PASSWORD) || (!!ACCESS_PASSWORD && reqPassword === ACCESS_PASSWORD);
    if (!isValidAdmin) {
      return res.status(401).json({ error: "Incorrect password! Only admins can delete from the roster." });
    }

    const { error } = await getSupabase().from("roster").delete().eq("id", req.params.id);
    if (error) throw error;
    try {
      await getSupabase().rpc("reset_roster_id_seq");
    } catch (e) {}
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error in DELETE /api/roster:", error);
    res.status(500).json({ error: error.message });
  }
});

// Schedule Endpoints
app.get("/api/schedules", checkAuth, async (_req, res) => {
  try {
    const { data: rawSchedules, error } = await getSupabase().from("schedules").select("*");
    if (error) {
      if (error.code === "PGRST205" || error.message?.includes("relation \"schedules\" does not exist")) {
        return res.status(409).json({
          error: "DATABASE_SETUP_NEEDED",
          message: "The 'schedules' table has not been created in your Supabase database yet."
        });
      }
      throw error;
    }
    res.json((rawSchedules || []).map((s) => mapScheduleFromDb(s)));
  } catch (error: any) {
    console.error("Error in GET /api/schedules:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/schedules", checkAdminAuth, async (req, res) => {
  try {
    const dbObj: any = mapScheduleToDb(req.body);
    dbObj.created_at = new Date().toISOString();
    const { data, error } = await getSupabase().from("schedules").insert([dbObj]).select("id").single();
    if (error) throw error;

    res.json({ success: true, id: String(data.id) });
  } catch (error: any) {
    console.error("Error in POST /api/schedules:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/schedules/:id", checkAdminAuth, async (req, res) => {
  try {
    const dbObj: any = mapScheduleToDb(req.body);
    const { error } = await getSupabase().from("schedules").update(dbObj).eq("id", req.params.id);
    if (error) throw error;

    res.json({ success: true, id: req.params.id });
  } catch (error: any) {
    console.error("Error in PUT /api/schedules:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/schedules/:id", checkAdminAuth, async (req, res) => {
  try {
    const { error } = await getSupabase().from("schedules").delete().eq("id", req.params.id);
    if (error) throw error;
    try {
      await getSupabase().rpc("reset_schedules_id_seq");
    } catch (e) {}
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error in DELETE /api/schedules:", error);
    res.status(500).json({ error: error.message });
  }
});

// League Presets Endpoints (stored in the `tournaments` table, one row per league)
// Reads are gated by the regular access password (every logged-in user needs the shared league
// config); writes require the admin action password, same as matches/roster.
app.get("/api/tournaments", checkAuth, async (_req, res) => {
  try {
    const { data: rawTournaments, error } = await getSupabase().from("tournaments").select("*").order("created_at", { ascending: true });
    if (error) {
      if (error.code === "PGRST205" || error.message?.includes("relation \"tournaments\" does not exist")) {
        return res.status(409).json({
          error: "DATABASE_SETUP_NEEDED",
          message: "The 'tournaments' table has not been created in your Supabase database yet."
        });
      }
      throw error;
    }
    res.json((rawTournaments || []).map((t) => mapLeaguePresetFromDb(t)));
  } catch (error: any) {
    console.error("Error in GET /api/tournaments:", error);
    res.status(500).json({ error: error.message });
  }
});

// Full sync: the frontend always keeps the complete league preset list in state and sends it
// whole (create/edit/delete a preset all funnel through here), so this upserts everything
// provided and drops rows that were removed.
app.put("/api/tournaments", checkAdminAuth, async (req, res) => {
  try {
    const presets: any[] = Array.isArray(req.body.tournaments) ? req.body.tournaments : [];
    if (presets.length === 0) {
      return res.status(400).json({ error: "At least 1 registered league is required." });
    }

    const nowIso = new Date().toISOString();
    const rows = presets.map((p: any) => {
      const { id, ...rest } = p;
      return { id: String(id), data: rest, updated_at: nowIso };
    });

    const { error: upsertError } = await getSupabase().from("tournaments").upsert(rows, { onConflict: "id" });
    if (upsertError) throw upsertError;

    const keepIds = rows.map((r) => r.id);
    const { error: deleteError } = await getSupabase().from("tournaments").delete().not("id", "in", `(${keepIds.join(",")})`);
    if (deleteError) throw deleteError;

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error in PUT /api/tournaments:", error);
    res.status(500).json({ error: error.message });
  }
});

// Setup Vite Dev server or Serve Static files
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
