// transit-gtfs-static-worker.js
// -----------------------------------------------------------
// - Default mode: GitHub Action downloads GTFS ZIP, uploads to R2,
//   then POSTs /log to record both ingest_log + gtfs_files.
// - Optional: this worker can still download daily if ENABLE_CRON_STATIC=true
// -----------------------------------------------------------

// ====== CONFIG ======
const ENABLE_CRON_STATIC = false; // <- set true if you want Worker to fetch daily

// ====== TIME + UTIL HELPERS ======
function fmtYMD_Montreal(d = new Date()) {
  const tz = 'America/Toronto';
  const y = d.toLocaleString('en-CA', { timeZone: tz, year: 'numeric' });
  const m = d.toLocaleString('en-CA', { timeZone: tz, month: '2-digit' });
  const day = d.toLocaleString('en-CA', { timeZone: tz, day: '2-digit' });
  return `${y}-${m}-${day}`;
}
const sha256Hex = async (ab) => {
  const h = await crypto.subtle.digest("SHA-256", ab);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
};
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function fetchWithTimeout(url, opts={}, ms=25000) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort("timeout"), ms);
  return fetch(url, { ...opts, signal: ctrl.signal, redirect: "follow" })
    .finally(() => clearTimeout(timeout));
}
function randInt(min, max) { return Math.floor(Math.random()*(max-min+1))+min; }

// ====== DB LOGGING ======
async function log(env, level, msg, provider_key = null, feed_id = null, detail = null) {
  await env.DB.prepare(`
    INSERT INTO ingest_log (ts, provider_key, feed_id, level, message, detail_json)
    VALUES (datetime('now','localtime'), ?1, ?2, ?3, ?4, ?5)
  `)
  .bind(provider_key, feed_id, level, msg, detail ? JSON.stringify(detail) : null)
  .run();
}

// ====== OPTIONAL SAVE (used only when cron mode enabled) ======
async function saveStatic(env, pkey, feed_id, ab) {
  const hash = await sha256Hex(ab);
  const exists = await env.DB
    .prepare("SELECT 1 FROM gtfs_files WHERE provider_key=?1 AND sha256=?2")
    .bind(pkey, hash)
    .first();
  if (exists) return { skipped: true };

  const date = fmtYMD_Montreal();
  const path = `gtfs-static/${pkey}/dt=${date}/gtfs_${pkey}_${date}.zip`;

  await env.R2.put(path, ab, { httpMetadata: { contentType: "application/zip" } });
  await env.DB.prepare(`
    INSERT INTO gtfs_files (provider_key, feed_id, ingested_at, sha256, bytes, r2_key)
    VALUES (?1, ?2, datetime('now','localtime'), ?3, ?4, ?5)
  `).bind(pkey, feed_id, hash, ab.byteLength, path).run();

  await log(env, "INFO", `Saved ${path}`, pkey, feed_id, {
    r2_key: path,
    bytes: ab.byteLength,
    sha256: hash,
    source: "worker-cron"
  });

  return { skipped: false, path };
}

// ====== MAIN WORKER ENTRY ======
export default {
  // ---------- HTTP handler ----------
  async fetch(req, env) {
    const url = new URL(req.url);

    // Basic health check
    if (req.method === "GET") {
      return new Response("GTFS-Static worker alive ✅");
    }

    // ✅ GitHub Action POST /log endpoint (secure)
    if (req.method === "POST" && url.pathname === "/log") {
      const provided = req.headers.get("X-Log-Secret");
      if (!env.LOG_SHARED_SECRET || provided !== env.LOG_SHARED_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }

      try {
        const body = await req.json();
        const {
          level = "INFO",
          message = "External log",
          provider_key = "stm",
          feed_id = "stm_gtfs_static",
          detail = {}
        } = body;

        // 1️⃣ Insert into ingest_log
        await log(env, level, message, provider_key, feed_id, detail);

        // 2️⃣ Also insert into gtfs_files if file metadata exists
        if (detail?.r2_key && detail?.bytes) {
          const hash = detail?.sha256 || "github-action";
          await env.DB.prepare(`
            INSERT INTO gtfs_files (provider_key, feed_id, ingested_at, sha256, bytes, r2_key)
            VALUES (?1, ?2, datetime('now','localtime'), ?3, ?4, ?5)
          `)
          .bind(provider_key, feed_id, hash, detail.bytes, detail.r2_key)
          .run();
        }

        return new Response("Logged ✅", { status: 200 });
      } catch (e) {
        return new Response("Log error: " + (e?.message || String(e)), { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },

  // ---------- Optional cron-based static fetch (off by default) ----------
  async scheduled(_evt, env) {
    if (!ENABLE_CRON_STATIC) return; // skip if disabled

    const { results: feeds } = await env.DB.prepare(`
      SELECT feed_id, provider_key, feed_kind, url
      FROM feed_endpoints
      WHERE is_active = 1 AND feed_kind = 'gtfs_static'
    `).all();

    for (const f of (feeds || [])) {
      const headers = {
        "User-Agent": "TransitStaticWorker/1.1 (+https://workers.cloudflare.com)",
        "Accept": "application/zip, */*"
      };

      const today = fmtYMD_Montreal();
      const key = `gtfs-static/${f.provider_key}/dt=${today}/gtfs_${f.provider_key}_${today}.zip`;
      const exists = await env.R2?.head?.(key);
      if (exists) {
        await log(env, "INFO", "Already saved today — skipping", f.provider_key, f.feed_id, { r2_key: key });
        continue;
      }

      let ab = null, lastErr = null;
      for (let i = 1; i <= 6; i++) {
        try {
          const res = await fetchWithTimeout(f.url, { headers }, 25000);
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
          ab = await res.arrayBuffer();
          break;
        } catch (e) {
          lastErr = e;
          const delay = [1500, 3000, 6000, 10000, 15000, 20000][i - 1] + randInt(0, 400);
          await sleep(delay);
        }
      }

      if (!ab) {
        await log(env, "ERROR", "Static download failed", f.provider_key, f.feed_id, {
          url: f.url,
          attempts: 6,
          error: lastErr?.message || String(lastErr)
        });
        continue;
      }

      try {
        await saveStatic(env, f.provider_key, f.feed_id, ab);
      } catch (e) {
        await log(env, "ERROR", "SaveStatic error", f.provider_key, f.feed_id, {
          error: e?.message || String(e)
        });
      }
    }
  },
};
