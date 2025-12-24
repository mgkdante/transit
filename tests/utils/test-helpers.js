const config = require('../config/test-config');

/**
 * Test helper utilities
 */

/**
 * Check if response indicates no data available
 */
function isNoDataResponse(response) {
  if (!response.ok) {
    const errorMsg = response.data?.error || JSON.stringify(response.data);
    return errorMsg.includes('No') && (
      errorMsg.includes('data') || 
      errorMsg.includes('found') ||
      errorMsg.includes('available')
    );
  }
  return false;
}

/**
 * Skip test if no data available
 */
function skipIfNoData(response, testName) {
  if (config.skipIfNoData && isNoDataResponse(response)) {
    console.log(`⏭️  Skipping ${testName}: No data available`);
    return true;
  }
  return false;
}

/**
 * Validate GeoJSON structure
 */
function validateGeoJson(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Response is not valid GeoJSON');
  }

  if (data.type !== 'FeatureCollection') {
    throw new Error(`Expected FeatureCollection, got ${data.type}`);
  }

  if (!Array.isArray(data.features)) {
    throw new Error('GeoJSON features must be an array');
  }

  return true;
}

/**
 * Validate GeoJSON feature
 */
function validateGeoJsonFeature(feature) {
  if (!feature.type || feature.type !== 'Feature') {
    throw new Error('Invalid GeoJSON feature type');
  }

  if (!feature.geometry) {
    throw new Error('GeoJSON feature missing geometry');
  }

  if (!feature.geometry.coordinates || !Array.isArray(feature.geometry.coordinates)) {
    throw new Error('GeoJSON feature missing valid coordinates');
  }

  return true;
}

/**
 * Validate coordinate ranges (Montreal area)
 */
function validateCoordinates(lat, lon) {
  // Montreal approximate bounds
  if (lat < 45.0 || lat > 46.0) {
    throw new Error(`Latitude ${lat} out of expected range for Montreal`);
  }

  if (lon < -74.0 || lon > -73.0) {
    throw new Error(`Longitude ${lon} out of expected range for Montreal`);
  }

  return true;
}

/**
 * Validate date format (YYYY-MM-DD)
 */
function validateDateFormat(date) {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD`);
  }

  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }

  return true;
}

/**
 * Validate hour (0-23)
 */
function validateHour(hour) {
  const h = parseInt(hour);
  if (isNaN(h) || h < 0 || h > 23) {
    throw new Error(`Invalid hour: ${hour}. Expected 0-23`);
  }
  return true;
}

/**
 * Check if timestamp is recent (within last 24 hours)
 */
function isRecentTimestamp(timestamp) {
  if (!timestamp) return false;
  
  const ts = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;
  const now = Math.floor(Date.now() / 1000);
  const dayInSeconds = 24 * 60 * 60;
  
  return (now - ts) < dayInSeconds;
}

/**
 * Wait for a specified time
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
async function retry(fn, attempts = 3, delay = 1000) {
  let lastError;
  
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (i < attempts - 1) {
        const backoffDelay = delay * Math.pow(2, i);
        await wait(backoffDelay);
      }
    }
  }
  
  throw lastError;
}

/**
 * Extract route IDs from response
 */
function extractRouteIds(data) {
  if (Array.isArray(data)) {
    return data.map(item => item.route_id || item.id).filter(Boolean);
  }
  if (data.route_id) {
    return [data.route_id];
  }
  return [];
}

/**
 * Extract stop IDs from response
 */
function extractStopIds(data) {
  if (Array.isArray(data)) {
    return data.map(item => item.stop_id || item.id).filter(Boolean);
  }
  if (data.stop_id) {
    return [data.stop_id];
  }
  return [];
}

module.exports = {
  isNoDataResponse,
  skipIfNoData,
  validateGeoJson,
  validateGeoJsonFeature,
  validateCoordinates,
  validateDateFormat,
  validateHour,
  isRecentTimestamp,
  wait,
  retry,
  extractRouteIds,
  extractStopIds
};

