// transit-static-api-worker.js
// Gold Layer: Static Data API Worker
// Serves GTFS static data from D1 database

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

// ---------- D1 Query helpers ----------
async function queryD1(env, sql, params = []) {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'static-api-worker.js:39',message:'queryD1 entry',data:{sql,sqlLength:sql.length,paramCount:params.length,params:params.map(p=>typeof p)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  try {
    const stmt = env.DB.prepare(sql);
    let result;
    if (params.length > 0) {
      result = await stmt.bind(...params).all();
    } else {
      result = await stmt.all();
    }
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'static-api-worker.js:46',message:'queryD1 success',data:{resultCount:result.results?.length||0,hasResults:!!result.results},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return result;
  } catch (e) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'static-api-worker.js:50',message:'queryD1 error',data:{error:e.message,errorType:e.name,sql},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.error('D1 query error:', e);
    throw e;
  }
}

// Get latest feed_date for a provider
async function getLatestFeedDate(env, provider) {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'static-api-worker.js:53',message:'getLatestFeedDate entry',data:{provider},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  // Try feed_info first
  let result = await queryD1(
    env,
    `SELECT feed_date FROM feed_info WHERE provider_key = ? ORDER BY feed_date DESC LIMIT 1`,
    [provider]
  );
  let feedDate = result.results[0]?.feed_date || null;
  
  // If feed_info is empty, fallback to querying routes table
  if (!feedDate) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'static-api-worker.js:60',message:'getLatestFeedDate fallback to routes',data:{provider},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    result = await queryD1(
      env,
      `SELECT DISTINCT feed_date FROM routes WHERE provider_key = ? ORDER BY feed_date DESC LIMIT 1`,
      [provider]
    );
    feedDate = result.results[0]?.feed_date || null;
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'static-api-worker.js:72',message:'getLatestFeedDate result',data:{provider,feedDate,resultCount:result.results?.length||0,hasResults:result.results?.length>0,usedFallback:!feedDate?false:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  return feedDate;
}

// ---------- API handlers ----------
async function handleRoutes(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const routeId = url.searchParams.get('route_id');
  const routeType = url.searchParams.get('route_type');
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  
  const feedDate = await getLatestFeedDate(env, provider);
  if (!feedDate) {
    return errorResponse('No static data found for provider', 404);
  }
  
  let sql = `SELECT * FROM routes WHERE provider_key = ? AND feed_date = ?`;
  const params = [provider, feedDate];
  
  if (routeId) {
    sql += ` AND route_id = ?`;
    params.push(routeId);
  }
  
  if (routeType) {
    sql += ` AND route_type = ?`;
    params.push(parseInt(routeType));
  }
  
  sql += ` ORDER BY route_id LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const result = await queryD1(env, sql, params);
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'static-api-worker.js:92',message:'handleRoutes response',data:{routeCount:result.results?.length||0,feedDate,provider,hasRouteId:!!routeId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  return jsonResponse({ routes: result.results, count: result.results.length });
}

async function handleStops(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const stopId = url.searchParams.get('stop_id');
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');
  const radius = url.searchParams.get('radius'); // in meters
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  
  const feedDate = await getLatestFeedDate(env, provider);
  if (!feedDate) {
    return errorResponse('No static data found for provider', 404);
  }
  
  let sql;
  const params = [provider, feedDate];
  
  if (stopId) {
    sql = `SELECT * FROM stops WHERE provider_key = ? AND feed_date = ? AND stop_id = ?`;
    params.push(stopId);
  } else if (lat && lon && radius) {
    // Nearby stops using bounding box (approximate)
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const radiusDeg = parseFloat(radius) / 111000; // rough conversion: 1 degree ≈ 111km
    
    sql = `SELECT *, 
      (6371000 * acos(cos(radians(?)) * cos(radians(stop_lat)) * 
       cos(radians(stop_lon) - radians(?)) + 
       sin(radians(?)) * sin(radians(stop_lat)))) AS distance
      FROM stops 
      WHERE provider_key = ? AND feed_date = ?
        AND stop_lat BETWEEN ? AND ?
        AND stop_lon BETWEEN ? AND ?
      ORDER BY distance
      LIMIT ? OFFSET ?`;
    params.push(
      latNum, lonNum, latNum, // for distance calculation
      provider, feedDate,
      latNum - radiusDeg, latNum + radiusDeg,
      lonNum - radiusDeg, lonNum + radiusDeg,
      limit, offset
    );
  } else {
    sql = `SELECT * FROM stops WHERE provider_key = ? AND feed_date = ? ORDER BY stop_id LIMIT ? OFFSET ?`;
    params.push(limit, offset);
  }
  
  const result = await queryD1(env, sql, params);
  return jsonResponse({ stops: result.results, count: result.results.length });
}

async function handleTrips(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const routeId = url.searchParams.get('route_id');
  const tripId = url.searchParams.get('trip_id');
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  
  const feedDate = await getLatestFeedDate(env, provider);
  if (!feedDate) {
    return errorResponse('No static data found for provider', 404);
  }
  
  let sql = `SELECT * FROM trips WHERE provider_key = ? AND feed_date = ?`;
  const params = [provider, feedDate];
  
  if (tripId) {
    sql += ` AND trip_id = ?`;
    params.push(tripId);
  } else if (routeId) {
    sql += ` AND route_id = ?`;
    params.push(routeId);
  }
  
  sql += ` ORDER BY trip_id LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const result = await queryD1(env, sql, params);
  return jsonResponse({ trips: result.results, count: result.results.length });
}

async function handleStopTimes(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const tripId = url.searchParams.get('trip_id');
  const stopId = url.searchParams.get('stop_id');
  const limit = parseInt(url.searchParams.get('limit') || '1000');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  
  if (!tripId) {
    return errorResponse('trip_id parameter required', 400);
  }
  
  const feedDate = await getLatestFeedDate(env, provider);
  if (!feedDate) {
    return errorResponse('No static data found for provider', 404);
  }
  
  let sql = `SELECT * FROM stop_times WHERE provider_key = ? AND feed_date = ? AND trip_id = ?`;
  const params = [provider, feedDate, tripId];
  
  if (stopId) {
    sql += ` AND stop_id = ?`;
    params.push(stopId);
  }
  
  sql += ` ORDER BY stop_sequence LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const result = await queryD1(env, sql, params);
  return jsonResponse({ stop_times: result.results, count: result.results.length });
}

async function handleShapes(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const routeId = url.searchParams.get('route_id');
  const shapeId = url.searchParams.get('shape_id');
  
  const feedDate = await getLatestFeedDate(env, provider);
  if (!feedDate) {
    return errorResponse('No static data found for provider', 404);
  }
  
  let sql;
  const params = [provider, feedDate];
  
  if (shapeId) {
    sql = `SELECT * FROM shapes WHERE provider_key = ? AND feed_date = ? AND shape_id = ? ORDER BY shape_pt_sequence`;
    params.push(shapeId);
  } else if (routeId) {
    // Get shape_id from trips, then get shape points
    const tripResult = await queryD1(
      env,
      `SELECT DISTINCT shape_id FROM trips WHERE provider_key = ? AND feed_date = ? AND route_id = ? AND shape_id IS NOT NULL LIMIT 1`,
      [provider, feedDate, routeId]
    );
    
    if (tripResult.results.length === 0) {
      return jsonResponse({ shapes: [], message: 'No shape found for route' });
    }
    
    const sid = tripResult.results[0].shape_id;
    sql = `SELECT * FROM shapes WHERE provider_key = ? AND feed_date = ? AND shape_id = ? ORDER BY shape_pt_sequence`;
    params.push(sid);
  } else {
    return errorResponse('route_id or shape_id parameter required', 400);
  }
  
  const result = await queryD1(env, sql, params);
  return jsonResponse({ shapes: result.results, count: result.results.length });
}

async function handleGeoJSONStops(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const routeId = url.searchParams.get('route_id');
  const limit = parseInt(url.searchParams.get('limit') || '1000');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  
  const feedDate = await getLatestFeedDate(env, provider);
  if (!feedDate) {
    return geojsonResponse([]);
  }
  
  let sql = `SELECT stop_id, stop_name, stop_lat, stop_lon FROM stops WHERE provider_key = ? AND feed_date = ?`;
  const params = [provider, feedDate];
  
  if (routeId) {
    // Get stops for a specific route via stop_times and trips
    sql = `SELECT DISTINCT s.stop_id, s.stop_name, s.stop_lat, s.stop_lon
           FROM stops s
           JOIN stop_times st ON s.provider_key = st.provider_key AND s.feed_date = st.feed_date AND s.stop_id = st.stop_id
           JOIN trips t ON st.provider_key = t.provider_key AND st.feed_date = t.feed_date AND st.trip_id = t.trip_id
           WHERE s.provider_key = ? AND s.feed_date = ? AND t.route_id = ?`;
    params.push(routeId);
  }
  
  sql += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  const result = await queryD1(env, sql, params);
  
  const features = result.results
    .filter(row => row.stop_lat && row.stop_lon)
    .map(row => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [parseFloat(row.stop_lon), parseFloat(row.stop_lat)],
      },
      properties: {
        stop_id: row.stop_id,
        stop_name: row.stop_name,
      },
    }));
  
  return geojsonResponse(features);
}

async function handleGeoJSONRoutes(req, env, url) {
  const provider = url.searchParams.get('provider') || 'stm';
  const routeId = url.searchParams.get('route_id');
  
  const feedDate = await getLatestFeedDate(env, provider);
  if (!feedDate) {
    return geojsonResponse([]);
  }
  
  let sql;
  const params = [provider, feedDate];
  
  if (routeId) {
    // Get shape for specific route
    const tripResult = await queryD1(
      env,
      `SELECT DISTINCT shape_id FROM trips WHERE provider_key = ? AND feed_date = ? AND route_id = ? AND shape_id IS NOT NULL LIMIT 1`,
      [provider, feedDate, routeId]
    );
    
    if (tripResult.results.length === 0) {
      return geojsonResponse([]);
    }
    
    const shapeId = tripResult.results[0].shape_id;
    sql = `SELECT shape_pt_lat, shape_pt_lon FROM shapes WHERE provider_key = ? AND feed_date = ? AND shape_id = ? ORDER BY shape_pt_sequence`;
    params.push(shapeId);
    
    const shapeResult = await queryD1(env, sql, params);
    const coordinates = shapeResult.results.map(row => [
      parseFloat(row.shape_pt_lon),
      parseFloat(row.shape_pt_lat),
    ]);
    
    const routeInfo = await queryD1(
      env,
      `SELECT route_id, route_short_name, route_long_name FROM routes WHERE provider_key = ? AND feed_date = ? AND route_id = ? LIMIT 1`,
      [provider, feedDate, routeId]
    );
    
    return geojsonResponse([{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coordinates,
      },
      properties: routeInfo.results[0] || { route_id: routeId },
    }]);
  } else {
    // Get all routes with shapes
    const routesResult = await queryD1(
      env,
      `SELECT DISTINCT t.route_id, r.route_short_name, r.route_long_name, t.shape_id
       FROM trips t
       JOIN routes r ON t.provider_key = r.provider_key AND t.feed_date = r.feed_date AND t.route_id = r.route_id
       WHERE t.provider_key = ? AND t.feed_date = ? AND t.shape_id IS NOT NULL`,
      [provider, feedDate]
    );
    
    const features = [];
    for (const route of routesResult.results) {
      const shapeResult = await queryD1(
        env,
        `SELECT shape_pt_lat, shape_pt_lon FROM shapes WHERE provider_key = ? AND feed_date = ? AND shape_id = ? ORDER BY shape_pt_sequence`,
        [provider, feedDate, route.shape_id]
      );
      
      if (shapeResult.results.length > 0) {
        const coordinates = shapeResult.results.map(row => [
          parseFloat(row.shape_pt_lon),
          parseFloat(row.shape_pt_lat),
        ]);
        
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: coordinates,
          },
          properties: {
            route_id: route.route_id,
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
          },
        });
      }
    }
    
    return geojsonResponse(features);
  }
}

async function handleGeoJSONShapes(req, env, url) {
  // Alias for handleGeoJSONRoutes when route_id is provided
  return await handleGeoJSONRoutes(req, env, url);
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
      return new Response('Static API Worker alive ✅', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    
    // API routes
    if (req.method === 'GET' && url.pathname.startsWith('/api/v1/static')) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/838a51f8-1edd-459f-9008-64cd16e5f4aa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'static-api-worker.js:414',message:'static API endpoint called',data:{pathname:url.pathname,searchParams:Object.fromEntries(url.searchParams)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      try {
        if (url.pathname === '/api/v1/static/routes') {
          return await handleRoutes(req, env, url);
        }
        if (url.pathname === '/api/v1/static/stops') {
          return await handleStops(req, env, url);
        }
        if (url.pathname === '/api/v1/static/trips') {
          return await handleTrips(req, env, url);
        }
        if (url.pathname === '/api/v1/static/stop-times') {
          return await handleStopTimes(req, env, url);
        }
        if (url.pathname === '/api/v1/static/shapes') {
          return await handleShapes(req, env, url);
        }
        
        return errorResponse('Endpoint not found', 404);
      } catch (e) {
        return errorResponse(e.message || 'Internal server error', 500);
      }
    }
    
    // GeoJSON routes
    if (req.method === 'GET' && url.pathname.startsWith('/api/v1/geojson')) {
      try {
        if (url.pathname === '/api/v1/geojson/stops') {
          return await handleGeoJSONStops(req, env, url);
        }
        if (url.pathname === '/api/v1/geojson/routes') {
          return await handleGeoJSONRoutes(req, env, url);
        }
        if (url.pathname === '/api/v1/geojson/shapes') {
          return await handleGeoJSONShapes(req, env, url);
        }
        
        return errorResponse('Endpoint not found', 404);
      } catch (e) {
        return errorResponse(e.message || 'Internal server error', 500);
      }
    }
    
    return errorResponse('Not found', 404);
  },
};

