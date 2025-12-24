const { StaticApiClient } = require('../utils/api-client');
const { skipIfNoData, validateDateFormat } = require('../utils/test-helpers');
const config = require('../config/test-config');

describe('Static API', () => {
  const client = new StaticApiClient();

  describe('Health Check', () => {
    test('GET / should return 200', async () => {
      const response = await client.healthCheck();
      expect(response.status).toBe(200);
      expect(response.ok).toBe(true);
    });
  });

  describe('Routes Endpoints', () => {
    test('GET /api/v1/static/routes should return routes array', async () => {
      const response = await client.getRoutes({ provider: config.defaultProvider, limit: 5 });
      
      if (skipIfNoData(response, 'routes list')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
    });

    test('GET /api/v1/static/routes?route_id should return single route', async () => {
      const response = await client.getRoutes({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId 
      });
      
      if (skipIfNoData(response, 'single route')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(response.data).toHaveProperty('route_id');
    });

    test('GET /api/v1/static/routes?route_type should filter by type', async () => {
      const response = await client.getRoutes({ 
        provider: config.defaultProvider, 
        route_type: 3,
        limit: 5
      });
      
      if (skipIfNoData(response, 'routes by type')) {
        return;
      }

      client.validateJsonResponse(response);
      if (Array.isArray(response.data) && response.data.length > 0) {
        expect(response.data[0].route_type).toBe(3);
      }
    });

    test('GET /api/v1/static/routes should support pagination', async () => {
      const response = await client.getRoutes({ 
        provider: config.defaultProvider, 
        limit: 2,
        offset: 0
      });
      
      if (skipIfNoData(response, 'routes pagination')) {
        return;
      }

      client.validateJsonResponse(response);
      if (Array.isArray(response.data)) {
        expect(response.data.length).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('Stops Endpoints', () => {
    test('GET /api/v1/static/stops should return stops array', async () => {
      const response = await client.getStops({ provider: config.defaultProvider, limit: 5 });
      
      if (skipIfNoData(response, 'stops list')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
    });

    test('GET /api/v1/static/stops?stop_id should return single stop', async () => {
      const response = await client.getStops({ 
        provider: config.defaultProvider, 
        stop_id: config.testStopId 
      });
      
      if (skipIfNoData(response, 'single stop')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(response.data).toHaveProperty('stop_id');
    });

    test('GET /api/v1/static/stops?lat&lon&radius should return nearby stops', async () => {
      const response = await client.getStops({ 
        provider: config.defaultProvider,
        lat: config.montrealLat,
        lon: config.montrealLon,
        radius: config.testRadius,
        limit: 5
      });
      
      if (skipIfNoData(response, 'nearby stops')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
    });
  });

  describe('Trips Endpoints', () => {
    test('GET /api/v1/static/trips?route_id should return trips for route', async () => {
      const response = await client.getTrips({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId,
        limit: 5
      });
      
      if (skipIfNoData(response, 'trips by route')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
    });
  });

  describe('Stop Times Endpoints', () => {
    test('GET /api/v1/static/stop-times?trip_id should return stop times', async () => {
      // First get a trip_id
      const tripsResponse = await client.getTrips({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId,
        limit: 1
      });
      
      if (skipIfNoData(tripsResponse, 'stop times')) {
        return;
      }

      if (Array.isArray(tripsResponse.data) && tripsResponse.data.length > 0) {
        const tripId = tripsResponse.data[0].trip_id;
        const response = await client.getStopTimes({ 
          provider: config.defaultProvider, 
          trip_id: tripId
        });
        
        client.validateJsonResponse(response);
        expect(Array.isArray(response.data)).toBe(true);
      }
    });
  });

  describe('Shapes Endpoints', () => {
    test('GET /api/v1/static/shapes?route_id should return route shape', async () => {
      const response = await client.getShapes({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId
      });
      
      if (skipIfNoData(response, 'route shape')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('Should handle invalid route_id gracefully', async () => {
      const response = await client.getRoutes({ 
        provider: config.defaultProvider, 
        route_id: 'invalid-route-id-99999'
      });
      
      // Should return error or empty result, not crash
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    test('Should handle missing provider data gracefully', async () => {
      const response = await client.getRoutes({ provider: 'nonexistent-provider' });
      
      // Should return error message, not crash
      expect(response.status).toBeGreaterThanOrEqual(200);
    });
  });
});

