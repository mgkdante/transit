// transit-gtfsrt-worker.js
// - Reads RT feeds from D1 (feed_endpoints WHERE feed_kind LIKE 'gtfsrt_%')
// - Uses STM apikey header when provider_key = 'stm'
// - Saves .pb to R2 under dt=<YYYY-MM-DD> (Montreal time)
// - Inserts into rt_*_raw with entity_count and feed_ts (Montreal time TEXT)
// - Logs detail_json (path, bytes, entity_count, feed_ts_local)

// ---------- Montreal time helpers ----------
function fmtYMD_Montreal(d = new Date()) {
  const tz = 'America/Toronto';
  const y = d.toLocaleString('en-CA', { timeZone: tz, year: 'numeric' });
  const m = d.toLocaleString('en-CA', { timeZone: tz, month: '2-digit' });
  const day = d.toLocaleString('en-CA', { timeZone: tz, day: '2-digit' });
  return `${y}-${m}-${day}`;
}

function fmtISO_Montreal(d = new Date()) {
  const tz = 'America/Toronto';
  const s = d.toLocaleString('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  .replace(',', '')
  .replace(/\//g, '-')
  .replace(/ /, 'T');              // "YYYY-MM-DDTHH:MM:SS"
  return s.replace(/:/g, '-');     // "YYYY-MM-DDTHH-MM-SS"
}

// ---------- tiny protobuf reader (GTFS-RT subset) ----------
// We only need: FeedMessage { header(1), entity(2 repeated) }
// Header.timestamp is field 4 (varint seconds).
function readVarint(u8, i) {
  let x = 0n, s = 0n, b;
  let pos = i;
  while (true) {
    b = u8[pos++];
    x |= BigInt(b & 0x7f) << s;
    if ((b & 0x80) === 0) break;
    s += 7n;
  }
  return { value: Number(x), next: pos };
}
function skipField(u8, pos, wireType) {
  if (wireType === 0) { // varint
    return readVarint(u8, pos).next;
  } else if (wireType === 1) { // 64-bit
    return pos + 8;
  } else if (wireType === 2) { // length-delimited
    const { value: len, next } = readVarint(u8, pos);
    return next + len;
  } else if (wireType === 5) { // 32-bit
    return pos + 4;
  } else {
    // wire types 3,4 deprecated; treat as error/skip-safe
    return pos;
  }
}
// Parse header submessage to find field 3 (timestamp, varint)
function parseHeaderTimestamp(u8, start, end) {
  let pos = start, ts = null;
  while (pos < end) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    if (fieldNo === 3 && wireType === 0) { // ✅ timestamp is field #3 (varint)
      const r = readVarint(u8, pos);
      ts = r.value; 
      pos = r.next;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return ts;
}

// Parse top-level FeedMessage: count entity(2) and extract header(1)->timestamp
function parseFeedMeta(ab) {
  const u8 = new Uint8Array(ab);
  let pos = 0, entityCount = 0, headerTsSec = null;
  while (pos < u8.length) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    if (wireType === 2) { // length-delimited submessage
      const { value: len, next: next2 } = readVarint(u8, pos);
      const subStart = next2, subEnd = next2 + len;
      if (fieldNo === 1) {
        // header
        const ts = parseHeaderTimestamp(u8, subStart, subEnd);
        if (typeof ts === 'number') headerTsSec = ts;
      } else if (fieldNo === 2) {
        // entity
        entityCount++;
      }
      pos = subEnd;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return { entityCount, headerTsSec };
}

// ---------- hashing ----------
const sha256Hex = async (ab) => {
  const h = await crypto.subtle.digest("SHA-256", ab);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
};

// ---------- DB/log helpers ----------
async function log(env, level, msg, provider_key = null, feed_id = null, detail = null) {
  await env.DB.prepare(`
    INSERT INTO ingest_log (ts, provider_key, feed_id, level, message, detail_json)
    VALUES (datetime('now','localtime'), ?1, ?2, ?3, ?4, ?5)
  `)
  .bind(provider_key, feed_id, level, msg, detail ? JSON.stringify(detail) : null)
  .run();
}
function buildHeaders(env, provider_key) {
  if (provider_key === 'stm' && env.STM_API_KEY) return { apikey: env.STM_API_KEY };
  return {};
}

// ---------- save RT ----------
async function saveRT(env, pkey, feed_id, kind, ab) {
  const hash = await sha256Hex(ab);
  const table = (kind === "gtfsrt_trip_updates") ? "rt_trip_updates_raw" : "rt_vehicle_positions_raw";

  // dedupe by hash
  const exists = await env.DB
    .prepare(`SELECT 1 FROM ${table} WHERE provider_key=?1 AND hash_sha256=?2`)
    .bind(pkey, hash)
    .first();
  if (exists) return { skipped: true };

  // parse meta: entity_count + header.timestamp (sec)
  const { entityCount, headerTsSec } = parseFeedMeta(ab);

  // path + local timestamps
  const nowLocal = new Date();
  const date = fmtYMD_Montreal(nowLocal);
  const isoLocal = fmtISO_Montreal(nowLocal);
  const fname = `${kind}_${isoLocal}.pb`;
  const path = `gtfs-rt/${pkey}/${kind}/dt=${date}/${fname}`;

  await env.R2.put(path, ab, { httpMetadata: { contentType: "application/octet-stream" } });

  // Convert feed_ts to Montreal-local TEXT if present
  let feedTsLocal = null;
  if (typeof headerTsSec === 'number' && headerTsSec > 0) {
    const d = new Date(headerTsSec * 1000);
    feedTsLocal = fmtISO_Montreal(d); // TEXT in Montreal time
  }

  await env.DB.prepare(`
    INSERT INTO ${table} (provider_key, feed_id, feed_ts, ingested_at, hash_sha256, entity_count)
    VALUES (?1, ?2, ?3, datetime('now','localtime'), ?4, ?5)
  `).bind(pkey, feed_id, feedTsLocal, hash, entityCount ?? null).run();

  // rich log
  await log(env, "INFO", `Saved ${path}`, pkey, feed_id, {
    r2_key: path,
    bytes: ab.byteLength,
    entity_count: entityCount,
    feed_ts_local: feedTsLocal
  });

  return { skipped: false, path };
}

// ---------- worker entry ----------
export default {
  async fetch() {
    return new Response("GTFS-RT worker alive ✅");
  },

  async scheduled(_evt, env) {
    const { results: feeds } = await env.DB.prepare(`
      SELECT feed_id, provider_key, feed_kind, url
      FROM feed_endpoints
      WHERE is_active = 1 AND feed_kind LIKE 'gtfsrt_%'
    `).all();

    for (const f of (feeds || [])) {
      try {
        const headers = buildHeaders(env, f.provider_key);
        const res = await fetch(f.url, { headers });
        if (!res.ok) {
          await log(env, "ERROR", `HTTP ${res.status} ${res.statusText}`, f.provider_key, f.feed_id);
          continue;
        }
        const ab = await res.arrayBuffer();
        const r = await saveRT(env, f.provider_key, f.feed_id, f.feed_kind, ab);
        if (!r.skipped) {
          // already logged inside saveRT
        }
      } catch (e) {
        await log(env, "ERROR", e?.message || String(e), f.provider_key, f.feed_id);
      }
    }
  },
};
