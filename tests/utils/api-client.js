const fetch = require('node-fetch');
const config = require('../config/test-config');

/**
 * Base API client for making HTTP requests
 */
class ApiClient {
  constructor(baseUrl, timeout = config.apiTimeout) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * Make a GET request
   */
  async get(endpoint, params = {}) {
    const url = new URL(endpoint, this.baseUrl);
    
    // Add query parameters
    Object.keys(params).forEach(key => {
      if (params[key] !== null && params[key] !== undefined) {
        url.searchParams.append(key, params[key]);
      }
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      });

      clearTimeout(timeoutId);

      const data = await response.json();
      
      return {
        status: response.status,
        ok: response.ok,
        data,
        headers: response.headers
      };
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.timeout}ms`);
      }
      
      throw error;
    }
  }

  /**
   * Retry a request with exponential backoff
   */
  async getWithRetry(endpoint, params = {}, attempts = config.retryAttempts) {
    let lastError;
    
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.get(endpoint, params);
      } catch (error) {
        lastError = error;
        
        if (i < attempts - 1) {
          const delay = config.retryDelay * Math.pow(2, i);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Validate response structure
   */
  validateResponse(response, expectedStatus = 200) {
    if (response.status !== expectedStatus) {
      throw new Error(`Expected status ${expectedStatus}, got ${response.status}`);
    }
    
    if (!response.ok && response.status >= 400) {
      throw new Error(`API error: ${JSON.stringify(response.data)}`);
    }
    
    return response;
  }

  /**
   * Validate JSON response
   */
  validateJsonResponse(response, expectedStatus = 200) {
    this.validateResponse(response, expectedStatus);
    
    if (typeof response.data !== 'object') {
      throw new Error('Response is not valid JSON');
    }
    
    return response;
  }
}

/**
 * Static API client
 */
class StaticApiClient extends ApiClient {
  constructor() {
    super(config.staticApiUrl);
  }

  async getRoutes(params = {}) {
    return this.get('/api/v1/static/routes', params);
  }

  async getStops(params = {}) {
    return this.get('/api/v1/static/stops', params);
  }

  async getTrips(params = {}) {
    return this.get('/api/v1/static/trips', params);
  }

  async getStopTimes(params = {}) {
    return this.get('/api/v1/static/stop-times', params);
  }

  async getShapes(params = {}) {
    return this.get('/api/v1/static/shapes', params);
  }

  async getGeoJsonStops(params = {}) {
    return this.get('/api/v1/geojson/stops', params);
  }

  async getGeoJsonRoutes(params = {}) {
    return this.get('/api/v1/geojson/routes', params);
  }

  async healthCheck() {
    return this.get('/');
  }
}

/**
 * RT API client
 */
class RtApiClient extends ApiClient {
  constructor() {
    super(config.rtApiUrl);
  }

  async getStatus() {
    return this.get('/api/v1/rt/status');
  }

  async getCurrent(params = {}) {
    return this.get('/api/v1/rt/current', params);
  }

  async getPositions(params = {}) {
    return this.get('/api/v1/rt/positions', params);
  }

  async getHistorical(params = {}) {
    return this.get('/api/v1/rt/historical', params);
  }

  async getHistoricalRange(params = {}) {
    return this.get('/api/v1/rt/historical/range', params);
  }

  async getHistoricalPositionsHourly(params = {}) {
    return this.get('/api/v1/rt/historical/positions/hourly', params);
  }

  async getHistoricalPositionsDaily(params = {}) {
    return this.get('/api/v1/rt/historical/positions/daily', params);
  }

  async getGeoJsonPositions(params = {}) {
    return this.get('/api/v1/rt/geojson/positions', params);
  }

  async getGeoJsonHistoricalPositions(params = {}) {
    return this.get('/api/v1/rt/geojson/historical-positions', params);
  }

  async getDelaysByRoute(params = {}) {
    return this.get('/api/v1/analytics/delays-by-route', params);
  }

  async getDelaysByStop(params = {}) {
    return this.get('/api/v1/analytics/delays-by-stop', params);
  }

  async getOnTimePerformance(params = {}) {
    return this.get('/api/v1/analytics/on-time-performance', params);
  }

  async getPeakHours(params = {}) {
    return this.get('/api/v1/analytics/peak-hours', params);
  }

  async healthCheck() {
    return this.get('/');
  }
}

module.exports = {
  ApiClient,
  StaticApiClient,
  RtApiClient
};

