// transit-rt-api-worker.js
// Gold Layer: RT API Worker
// Serves hot RT data (last 24h) from Bronze and historical RT data from Silver

// ---------- Montreal time helpers ----------
function fmtYMD_Montreal(d = new Date()) {
  const tz = 'America/Toronto';
  const y = d.toLocaleString('en-CA', { timeZone: tz, year: 'numeric' });
  const m = d.toLocaleString('en-CA', { timeZone: tz, month: '2-digit' });
  const day = d.toLocaleString('en-CA', { timeZone: tz, day: '2-digit' });
  return `${y}-${m}-${day}`;
}

function getHoursAgo(hours) {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d;
}

// ---------- Protobuf parsing (reused from RT worker) ----------
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
  if (wireType === 0) return readVarint(u8, pos).next;
  if (wireType === 1) return pos + 8;
  if (wireType === 2) {
    const { value: len, next } = readVarint(u8, pos);
    return next + len;
  }
  if (wireType === 5) return pos + 4;
  return pos;
}

function parseHeaderTimestamp(u8, start, end) {
  let pos = start, ts = null;
  while (pos < end) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    if (fieldNo === 3 && wireType === 0) {
      const r = readVarint(u8, pos);
      ts = r.value;
      pos = r.next;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return ts;
}

// Extended protobuf parser to extract full entity data
function parseEntity(u8, start, end) {
  let pos = start;
  const entity = { id: null, trip_update: null, vehicle: null };
  
  while (pos < end) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    
    if (wireType === 2) {
      const { value: len, next: next2 } = readVarint(u8, pos);
      const subStart = next2, subEnd = next2 + len;
      
      if (fieldNo === 1) {
        // id
        entity.id = new TextDecoder().decode(u8.subarray(subStart, subEnd));
      } else if (fieldNo === 3) {
        // trip_update
        entity.trip_update = parseTripUpdate(u8, subStart, subEnd);
      } else if (fieldNo === 4) {
        // vehicle
        entity.vehicle = parseVehiclePosition(u8, subStart, subEnd);
      }
      pos = subEnd;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return entity;
}

function parseTripUpdate(u8, start, end) {
  let pos = start;
  const tu = { trip: {}, stop_time_update: [] };
  
  while (pos < end) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    
    if (wireType === 2) {
      const { value: len, next: next2 } = readVarint(u8, pos);
      const subStart = next2, subEnd = next2 + len;
      
      if (fieldNo === 1) {
        tu.trip = parseTripDescriptor(u8, subStart, subEnd);
      } else if (fieldNo === 2) {
        tu.stop_time_update.push(parseStopTimeUpdate(u8, subStart, subEnd));
      }
      pos = subEnd;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return tu;
}

function parseVehiclePosition(u8, start, end) {
  let pos = start;
  const vp = { trip: {}, vehicle: {}, position: {}, timestamp: null };
  
  while (pos < end) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    
    if (wireType === 2) {
      const { value: len, next: next2 } = readVarint(u8, pos);
      const subStart = next2, subEnd = next2 + len;
      
      if (fieldNo === 1) {
        vp.trip = parseTripDescriptor(u8, subStart, subEnd);
      } else if (fieldNo === 2) {
        vp.vehicle = parseVehicleDescriptor(u8, subStart, subEnd);
      } else if (fieldNo === 3) {
        vp.position = parsePosition(u8, subStart, subEnd);
      }
      pos = subEnd;
    } else if (fieldNo === 4 && wireType === 0) {
      const r = readVarint(u8, pos);
      vp.timestamp = r.value;
      pos = r.next;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return vp;
}

function parseTripDescriptor(u8, start, end) {
  let pos = start;
  const td = {};
  
  while (pos < end) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    
    if (wireType === 2) {
      const { value: len, next: next2 } = readVarint(u8, pos);
      const str = new TextDecoder().decode(u8.subarray(next2, next2 + len));
      if (fieldNo === 1) td.trip_id = str;
      else if (fieldNo === 3) td.route_id = str;
      pos = next2 + len;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return td;
}

function parseVehicleDescriptor(u8, start, end) {
  let pos = start;
  const vd = {};
  
  while (pos < end) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    
    if (wireType === 2) {
      const { value: len, next: next2 } = readVarint(u8, pos);
      const str = new TextDecoder().decode(u8.subarray(next2, next2 + len));
      if (fieldNo === 1) vd.id = str;
      pos = next2 + len;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return vd;
}

function parsePosition(u8, start, end) {
  let pos = start;
  const pos_obj = { latitude: null, longitude: null, bearing: null, speed: null };
  
  while (pos < end) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    
    if (fieldNo === 1 && wireType === 5) {
      // latitude (float)
      const view = new DataView(u8.buffer, u8.byteOffset + pos, 4);
      pos_obj.latitude = view.getFloat32(pos, true);
      pos += 4;
    } else if (fieldNo === 2 && wireType === 5) {
      // longitude (float)
      const view = new DataView(u8.buffer, u8.byteOffset + pos, 4);
      pos_obj.longitude = view.getFloat32(pos, true);
      pos += 4;
    } else if (fieldNo === 3 && wireType === 5) {
      // bearing (float)
      const view = new DataView(u8.buffer, u8.byteOffset + pos, 4);
      pos_obj.bearing = view.getFloat32(pos, true);
      pos += 4;
    } else if (fieldNo === 4 && wireType === 5) {
      // speed (float)
      const view = new DataView(u8.buffer, u8.byteOffset + pos, 4);
      pos_obj.speed = view.getFloat32(pos, true);
      pos += 4;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return pos_obj;
}

function parseStopTimeUpdate(u8, start, end) {
  let pos = start;
  const stu = { stop_id: null, stop_sequence: null, arrival: {}, departure: {} };
  
  while (pos < end) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    
    if (wireType === 2) {
      const { value: len, next: next2 } = readVarint(u8, pos);
      const subStart = next2, subEnd = next2 + len;
      
      if (fieldNo === 1) {
        stu.stop_id = new TextDecoder().decode(u8.subarray(subStart, subEnd));
      } else if (fieldNo === 2) {
        stu.arrival = parseStopTimeEvent(u8, subStart, subEnd);
      } else if (fieldNo === 3) {
        stu.departure = parseStopTimeEvent(u8, subStart, subEnd);
      }
      pos = subEnd;
    } else if (fieldNo === 4 && wireType === 0) {
      const r = readVarint(u8, pos);
      stu.stop_sequence = r.value;
      pos = r.next;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return stu;
}

function parseStopTimeEvent(u8, start, end) {
  let pos = start;
  const ste = { delay: null, time: null };
  
  while (pos < end) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    
    if (fieldNo === 1 && wireType === 0) {
      const r = readVarint(u8, pos);
      ste.delay = r.value;
      pos = r.next;
    } else if (fieldNo === 2 && wireType === 0) {
      const r = readVarint(u8, pos);
      ste.time = r.value;
      pos = r.next;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return ste;
}

function parseFeedMessage(ab) {
  const u8 = new Uint8Array(ab);
  let pos = 0;
  const feed = { header: { timestamp: null }, entity: [] };
  
  while (pos < u8.length) {
    const { value: key, next } = readVarint(u8, pos);
    pos = next;
    const fieldNo = key >> 3;
    const wireType = key & 7;
    
    if (wireType === 2) {
      const { value: len, next: next2 } = readVarint(u8, pos);
      const subStart = next2, subEnd = next2 + len;
      
      if (fieldNo === 1) {
        // header
        feed.header.timestamp = parseHeaderTimestamp(u8, subStart, subEnd);
      } else if (fieldNo === 2) {
        // entity
        feed.entity.push(parseEntity(u8, subStart, subEnd));
      }
      pos = subEnd;
    } else {
      pos = skipField(u8, pos, wireType);
    }
  }
  return feed;
}

// ---------- R2 helpers ----------
async function listHotRTFiles(env, provider, feedKind, hoursBack = 24) {
  const threshold = getHoursAgo(hoursBack);
  const thresholdDate = fmtYMD_Montreal(threshold);
  const today = fmtYMD_Montreal();
  
  const files = [];
  const dates = [thresholdDate, today];
  
  for (const date of dates) {
    const prefix = `gtfs-rt/${provider}/${feedKind}/dt=${date}/`;
    const list = await env.R2_BRONZE.list({ prefix });
    
    for (const obj of list.objects) {
      const timestamp = obj.uploaded ? new Date(obj.uploaded) : new Date();
      if (timestamp >= threshold) {
        files.push({ key: obj.key, uploaded: timestamp });
      }
    }
  }
  
  return files.sort((a, b) => b.uploaded - a.uploaded);
}

async function readHotRTFile(env, key) {
  const obj = await env.R2_BRONZE.get(key);
  if (!obj) return null;
  return await obj.arrayBuffer();
}

async function queryD1Historical(env, provider, feedKind, date, aggregation = 'hourly', hour = null, routeId = null, stopId = null) {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'rt-api-worker.js:355',message:'queryD1Historical entry',data:{provider,feedKind,date,aggregation,hour,routeId,stopId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  try {
    let tableName;
    let sql;
    const params = [provider, date];
    
    if (feedKind === 'gtfsrt_trip_updates') {
      if (aggregation === 'hourly') {
        tableName = 'rt_delays_hourly';
        sql = `SELECT * FROM ${tableName} WHERE provider_key = ? AND date = ?`;
        if (hour !== null) {
          sql += ` AND hour = ?`;
          params.push(hour);
        }
      } else {
        tableName = 'rt_delays_daily';
        sql = `SELECT * FROM ${tableName} WHERE provider_key = ? AND date = ?`;
      }
      
      if (routeId) {
        sql += ` AND route_id = ?`;
        params.push(routeId);
      }
      if (stopId) {
        sql += ` AND stop_id = ?`;
        params.push(stopId);
      }
    } else if (feedKind === 'gtfsrt_vehicle_positions') {
      if (aggregation === 'hourly') {
        tableName = 'rt_positions_hourly';
        sql = `SELECT * FROM ${tableName} WHERE provider_key = ? AND date = ?`;
        if (hour !== null) {
          sql += ` AND hour = ?`;
          params.push(hour);
        }
      } else {
        tableName = 'rt_positions_daily';
        sql = `SELECT * FROM ${tableName} WHERE provider_key = ? AND date = ?`;
      }
      
      if (routeId) {
        sql += ` AND route_id = ?`;
        params.push(routeId);
      }
    }
    
    sql += ` ORDER BY date`;
    if (aggregation === 'hourly') {
      sql += `, hour`;
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'rt-api-worker.js:405',message:'queryD1Historical before execute',data:{tableName,sql,sqlLength:sql.length,paramCount:params.length,params:params.map(p=>typeof p)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    const stmt = env.DB.prepare(sql);
    const result = await stmt.bind(...params).all();
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'rt-api-worker.js:408',message:'queryD1Historical success',data:{resultCount:result.results?.length||0,hasResults:!!result.results&&result.results.length>0,tableName},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return result.results;
  } catch (e) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'rt-api-worker.js:411',message:'queryD1Historical error',data:{error:e.message,errorType:e.name,tableName,sql},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.error('D1 query error:', e);
    return null;
  }
}

// ---------- Response helpers ----------
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function geojsonResponse(features, status = 200) {
  const geojson = {
    type: 'FeatureCollection',
    features: features,
  };
  return new Response(JSON.stringify(geojson, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/geo+json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// ---------- API handlers ----------
async function handleCurrentTripUpdates(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const routeId = url.searchParams.get('route_id');
  const stopId = url.searchParams.get('stop_id');
  
  const files = await listHotRTFiles(env, provider, 'gtfsrt_trip_updates', 24);
  if (files.length === 0) {
    return jsonResponse({ trip_updates: [], message: 'No recent trip updates found' });
  }
  
  // Read latest file
  const latest = files[0];
  const ab = await readHotRTFile(env, latest.key);
  if (!ab) {
    return errorResponse('Failed to read RT file', 500);
  }
  
  const feed = parseFeedMessage(ab);
  const tripUpdates = [];
  
  for (const entity of feed.entity) {
    if (!entity.trip_update) continue;
    
    const tu = entity.trip_update;
    if (routeId && tu.trip.route_id !== routeId) continue;
    
    for (const stu of tu.stop_time_update) {
      if (stopId && stu.stop_id !== stopId) continue;
      
      tripUpdates.push({
        trip_id: tu.trip.trip_id,
        route_id: tu.trip.route_id,
        stop_id: stu.stop_id,
        stop_sequence: stu.stop_sequence,
        arrival_delay: stu.arrival.delay,
        departure_delay: stu.departure.delay,
        arrival_time: stu.arrival.time,
        departure_time: stu.departure.time,
      });
    }
  }
  
  return jsonResponse({ trip_updates: tripUpdates, feed_timestamp: feed.header.timestamp });
}

async function handleCurrentPositions(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const routeId = url.searchParams.get('route_id');
  const vehicleId = url.searchParams.get('vehicle_id');
  
  const files = await listHotRTFiles(env, provider, 'gtfsrt_vehicle_positions', 24);
  if (files.length === 0) {
    return jsonResponse({ positions: [], message: 'No recent vehicle positions found' });
  }
  
  const latest = files[0];
  const ab = await readHotRTFile(env, latest.key);
  if (!ab) {
    return errorResponse('Failed to read RT file', 500);
  }
  
  const feed = parseFeedMessage(ab);
  const positions = [];
  
  for (const entity of feed.entity) {
    if (!entity.vehicle) continue;
    
    const vp = entity.vehicle;
    if (routeId && vp.trip.route_id !== routeId) continue;
    if (vehicleId && vp.vehicle.id !== vehicleId) continue;
    
    positions.push({
      vehicle_id: vp.vehicle.id,
      trip_id: vp.trip.trip_id,
      route_id: vp.trip.route_id,
      latitude: vp.position.latitude,
      longitude: vp.position.longitude,
      bearing: vp.position.bearing,
      speed: vp.position.speed,
      timestamp: vp.timestamp,
    });
  }
  
  return jsonResponse({ positions, feed_timestamp: feed.header.timestamp });
}

async function handleGeoJSONPositions(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const routeId = url.searchParams.get('route_id');
  
  const files = await listHotRTFiles(env, provider, 'gtfsrt_vehicle_positions', 24);
  if (files.length === 0) {
    return geojsonResponse([]);
  }
  
  const latest = files[0];
  const ab = await readHotRTFile(env, latest.key);
  if (!ab) {
    return errorResponse('Failed to read RT file', 500);
  }
  
  const feed = parseFeedMessage(ab);
  const features = [];
  
  for (const entity of feed.entity) {
    if (!entity.vehicle) continue;
    
    const vp = entity.vehicle;
    if (routeId && vp.trip.route_id !== routeId) continue;
    
    if (vp.position.latitude && vp.position.longitude) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [vp.position.longitude, vp.position.latitude],
        },
        properties: {
          vehicle_id: vp.vehicle.id,
          trip_id: vp.trip.trip_id,
          route_id: vp.trip.route_id,
          bearing: vp.position.bearing,
          speed: vp.position.speed,
          timestamp: vp.timestamp,
        },
      });
    }
  }
  
  return geojsonResponse(features);
}

async function handleGeoJSONHistoricalPositions(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const date = url.searchParams.get('date');
  const hour = url.searchParams.get('hour');
  const routeId = url.searchParams.get('route_id');
  
  if (!date) {
    return errorResponse('date parameter required', 400);
  }
  
  try {
    let sql;
    const params = [provider, date];
    
    if (hour !== null) {
      sql = `SELECT route_id, vehicle_id, trip_id, avg_latitude, avg_longitude, avg_bearing, avg_speed, vehicle_count 
             FROM rt_positions_hourly 
             WHERE provider_key = ? AND date = ? AND hour = ?`;
      params.push(parseInt(hour));
    } else {
      sql = `SELECT route_id, vehicle_id, trip_id, avg_latitude, avg_longitude, avg_bearing, avg_speed, vehicle_count 
             FROM rt_positions_daily 
             WHERE provider_key = ? AND date = ?`;
    }
    
    if (routeId) {
      sql += ` AND route_id = ?`;
      params.push(routeId);
    }
    
    const stmt = env.DB.prepare(sql);
    const result = await stmt.bind(...params).all();
    
    const features = result.results
      .filter(row => row.avg_latitude && row.avg_longitude)
      .map(row => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [parseFloat(row.avg_longitude), parseFloat(row.avg_latitude)],
        },
        properties: {
          route_id: row.route_id,
          vehicle_id: row.vehicle_id,
          trip_id: row.trip_id,
          bearing: row.avg_bearing,
          speed: row.avg_speed,
          vehicle_count: row.vehicle_count,
        },
      }));
    
    return geojsonResponse(features);
  } catch (e) {
    return errorResponse(e.message || 'Internal server error', 500);
  }
}

async function handleHistorical(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const feedKind = url.searchParams.get('feed_kind') || 'gtfsrt_trip_updates';
  const date = url.searchParams.get('date');
  const hour = url.searchParams.get('hour');
  const routeId = url.searchParams.get('route_id');
  const stopId = url.searchParams.get('stop_id');
  const aggregation = hour ? 'hourly' : 'daily';
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'rt-api-worker.js:651',message:'handleHistorical entry',data:{provider,feedKind,date,hour,routeId,stopId,aggregation},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  if (!date) {
    return errorResponse('date parameter required', 400);
  }
  
  // Query D1 for historical data
  const data = await queryD1Historical(
    env,
    provider,
    feedKind,
    date,
    aggregation,
    hour ? parseInt(hour) : null,
    routeId,
    stopId
  );
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'rt-api-worker.js:676',message:'handleHistorical after query',data:{dataIsNull:data===null,dataLength:data?.length||0,hasData:!!data&&data.length>0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  if (!data || data.length === 0) {
    return errorResponse('Historical data not found', 404);
  }
  
  return jsonResponse({
    aggregation,
    date,
    hour: hour || null,
    feed_kind: feedKind,
    count: data.length,
    data: data,
  });
}

async function handleHistoricalRange(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const feedKind = url.searchParams.get('feed_kind') || 'gtfsrt_trip_updates';
  const startDate = url.searchParams.get('start');
  const endDate = url.searchParams.get('end');
  const routeId = url.searchParams.get('route_id');
  const stopId = url.searchParams.get('stop_id');
  
  if (!startDate || !endDate) {
    return errorResponse('start and end date parameters required', 400);
  }
  
  // Query D1 for date range (using daily aggregation)
  let tableName = feedKind === 'gtfsrt_trip_updates' ? 'rt_delays_daily' : 'rt_positions_daily';
  let sql = `SELECT * FROM ${tableName} WHERE provider_key = ? AND date >= ? AND date <= ?`;
  const params = [provider, startDate, endDate];
  
  if (routeId) {
    sql += ` AND route_id = ?`;
    params.push(routeId);
  }
  if (stopId && feedKind === 'gtfsrt_trip_updates') {
    sql += ` AND stop_id = ?`;
    params.push(stopId);
  }
  
  sql += ` ORDER BY date`;
  
  try {
    const stmt = env.DB.prepare(sql);
    const result = await stmt.bind(...params).all();
    
    return jsonResponse({
      aggregation: 'daily',
      start_date: startDate,
      end_date: endDate,
      feed_kind: feedKind,
      count: result.results.length,
      data: result.results,
    });
  } catch (e) {
    return errorResponse(e.message || 'Internal server error', 500);
  }
}

async function handleStatus(req, env) {
  const provider = 'stm';
  
  // Check latest hot data
  const tripFiles = await listHotRTFiles(env, provider, 'gtfsrt_trip_updates', 24);
  const posFiles = await listHotRTFiles(env, provider, 'gtfsrt_vehicle_positions', 24);
  
  return jsonResponse({
    status: 'operational',
    hot_data: {
      trip_updates: {
        latest_file: tripFiles[0]?.key || null,
        latest_timestamp: tripFiles[0]?.uploaded || null,
        file_count: tripFiles.length,
      },
      vehicle_positions: {
        latest_file: posFiles[0]?.key || null,
        latest_timestamp: posFiles[0]?.uploaded || null,
        file_count: posFiles.length,
      },
    },
    historical_data: {
      note: 'Available via /api/v1/rt/historical endpoints',
    },
  });
}

// ---------- Analytics handlers ----------
async function getLatestFeedDate(env, provider) {
  try {
    const stmt = env.DB.prepare(`SELECT feed_date FROM feed_info WHERE provider_key = ? ORDER BY feed_date DESC LIMIT 1`);
    const result = await stmt.bind(provider).first();
    return result?.feed_date || null;
  } catch (e) {
    return null;
  }
}

async function handleAnalyticsDelaysByRoute(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const startDate = url.searchParams.get('start_date');
  const endDate = url.searchParams.get('end_date') || startDate;
  
  if (!startDate) {
    return errorResponse('start_date parameter required', 400);
  }
  
  try {
    const feedDate = await getLatestFeedDate(env, provider);
    if (!feedDate) {
      return errorResponse('No static data found for provider', 404);
    }
    
    // Join RT delays with routes table (using latest feed_date)
    const sql = `
      SELECT 
        r.route_id,
        r.route_short_name,
        r.route_long_name,
        AVG(rd.avg_arrival_delay) as avg_arrival_delay,
        MAX(rd.max_arrival_delay) as max_arrival_delay,
        MIN(rd.min_arrival_delay) as min_arrival_delay,
        AVG(rd.avg_departure_delay) as avg_departure_delay,
        SUM(rd.trip_count) as total_trips
      FROM rt_delays_daily rd
      JOIN routes r ON rd.provider_key = r.provider_key AND rd.route_id = r.route_id AND r.feed_date = ?
      WHERE rd.provider_key = ? AND rd.date >= ? AND rd.date <= ?
      GROUP BY r.route_id, r.route_short_name, r.route_long_name
      ORDER BY avg_arrival_delay DESC
    `;
    
    const stmt = env.DB.prepare(sql);
    const result = await stmt.bind(feedDate, provider, startDate, endDate).all();
    
    return jsonResponse({
      metric: 'delays_by_route',
      start_date: startDate,
      end_date: endDate,
      count: result.results.length,
      data: result.results,
    });
  } catch (e) {
    return errorResponse(e.message || 'Internal server error', 500);
  }
}

async function handleAnalyticsDelaysByStop(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const startDate = url.searchParams.get('start_date');
  const endDate = url.searchParams.get('end_date') || startDate;
  
  if (!startDate) {
    return errorResponse('start_date parameter required', 400);
  }
  
  try {
    const feedDate = await getLatestFeedDate(env, provider);
    if (!feedDate) {
      return errorResponse('No static data found for provider', 404);
    }
    
    // Join RT delays with stops table (using latest feed_date)
    const sql = `
      SELECT 
        s.stop_id,
        s.stop_name,
        s.stop_lat,
        s.stop_lon,
        AVG(rd.avg_arrival_delay) as avg_arrival_delay,
        MAX(rd.max_arrival_delay) as max_arrival_delay,
        MIN(rd.min_arrival_delay) as min_arrival_delay,
        AVG(rd.avg_departure_delay) as avg_departure_delay,
        SUM(rd.trip_count) as total_trips
      FROM rt_delays_daily rd
      JOIN stops s ON rd.provider_key = s.provider_key AND rd.stop_id = s.stop_id AND s.feed_date = ?
      WHERE rd.provider_key = ? AND rd.date >= ? AND rd.date <= ?
      GROUP BY s.stop_id, s.stop_name, s.stop_lat, s.stop_lon
      ORDER BY avg_arrival_delay DESC
    `;
    
    const stmt = env.DB.prepare(sql);
    const result = await stmt.bind(feedDate, provider, startDate, endDate).all();
    
    return jsonResponse({
      metric: 'delays_by_stop',
      start_date: startDate,
      end_date: endDate,
      count: result.results.length,
      data: result.results,
    });
  } catch (e) {
    return errorResponse(e.message || 'Internal server error', 500);
  }
}

async function handleAnalyticsOnTimePerformance(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const startDate = url.searchParams.get('start_date');
  const endDate = url.searchParams.get('end_date') || startDate;
  const routeId = url.searchParams.get('route_id');
  const threshold = parseInt(url.searchParams.get('threshold') || '300'); // 5 minutes in seconds
  
  if (!startDate) {
    return errorResponse('start_date parameter required', 400);
  }
  
  try {
    const feedDate = await getLatestFeedDate(env, provider);
    if (!feedDate) {
      return errorResponse('No static data found for provider', 404);
    }
    
    let sql = `
      SELECT 
        r.route_id,
        r.route_short_name,
        r.route_long_name,
        COUNT(*) as total_trips,
        SUM(CASE WHEN ABS(rd.avg_arrival_delay) <= ? THEN 1 ELSE 0 END) as on_time_trips,
        (SUM(CASE WHEN ABS(rd.avg_arrival_delay) <= ? THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as on_time_percentage
      FROM rt_delays_daily rd
      JOIN routes r ON rd.provider_key = r.provider_key AND rd.route_id = r.route_id AND r.feed_date = ?
      WHERE rd.provider_key = ? AND rd.date >= ? AND rd.date <= ?
    `;
    const params = [threshold, threshold, feedDate, provider, startDate, endDate];
    
    if (routeId) {
      sql += ` AND r.route_id = ?`;
      params.push(routeId);
    }
    
    sql += ` GROUP BY r.route_id, r.route_short_name, r.route_long_name ORDER BY on_time_percentage DESC`;
    
    const stmt = env.DB.prepare(sql);
    const result = await stmt.bind(...params).all();
    
    return jsonResponse({
      metric: 'on_time_performance',
      threshold_seconds: threshold,
      start_date: startDate,
      end_date: endDate,
      count: result.results.length,
      data: result.results,
    });
  } catch (e) {
    return errorResponse(e.message || 'Internal server error', 500);
  }
}

async function handleAnalyticsPeakHours(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const date = url.searchParams.get('date');
  
  if (!date) {
    return errorResponse('date parameter required', 400);
  }
  
  try {
    const sql = `
      SELECT 
        hour,
        COUNT(*) as trip_count,
        AVG(avg_arrival_delay) as avg_delay,
        SUM(trip_count) as total_trips
      FROM rt_delays_hourly
      WHERE provider_key = ? AND date = ?
      GROUP BY hour
      ORDER BY trip_count DESC
    `;
    
    const stmt = env.DB.prepare(sql);
    const result = await stmt.bind(provider, date).all();
    
    return jsonResponse({
      metric: 'peak_hours',
      date: date,
      count: result.results.length,
      data: result.results,
    });
  } catch (e) {
    return errorResponse(e.message || 'Internal server error', 500);
  }
}

// ---------- Main worker ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }
    
    // Health check
    if (req.method === 'GET' && url.pathname === '/') {
      return new Response('RT API Worker alive ✅', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    
    // API routes
    if (req.method === 'GET' && url.pathname.startsWith('/api/v1/rt')) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'rt-api-worker.js:970',message:'RT API endpoint called',data:{pathname:url.pathname,searchParams:Object.fromEntries(url.searchParams)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      try {
        if (url.pathname === '/api/v1/rt/current') {
          return await handleCurrentTripUpdates(req, env, url);
        }
        if (url.pathname === '/api/v1/rt/positions') {
          return await handleCurrentPositions(req, env, url);
        }
        if (url.pathname === '/api/v1/rt/geojson/positions') {
          return await handleGeoJSONPositions(req, env, url);
        }
        if (url.pathname === '/api/v1/rt/geojson/historical-positions') {
          return await handleGeoJSONHistoricalPositions(req, env, url);
        }
        if (url.pathname.startsWith('/api/v1/rt/historical')) {
          if (url.pathname === '/api/v1/rt/historical/range') {
            return await handleHistoricalRange(req, env, url);
          }
          return await handleHistorical(req, env, url);
        }
        if (url.pathname === '/api/v1/rt/status') {
          return await handleStatus(req, env);
        }
        
        return errorResponse('Endpoint not found', 404);
      } catch (e) {
        return errorResponse(e.message || 'Internal server error', 500);
      }
    }
    
    // Analytics routes
    if (req.method === 'GET' && url.pathname.startsWith('/api/v1/analytics')) {
      try {
        if (url.pathname === '/api/v1/analytics/delays-by-route') {
          return await handleAnalyticsDelaysByRoute(req, env, url);
        }
        if (url.pathname === '/api/v1/analytics/delays-by-stop') {
          return await handleAnalyticsDelaysByStop(req, env, url);
        }
        if (url.pathname === '/api/v1/analytics/on-time-performance') {
          return await handleAnalyticsOnTimePerformance(req, env, url);
        }
        if (url.pathname === '/api/v1/analytics/peak-hours') {
          return await handleAnalyticsPeakHours(req, env, url);
        }
        
        return errorResponse('Endpoint not found', 404);
      } catch (e) {
        return errorResponse(e.message || 'Internal server error', 500);
      }
    }
    
    return errorResponse('Not found', 404);
  },
};

