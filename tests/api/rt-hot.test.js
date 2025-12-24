const { RtApiClient } = require('../utils/api-client');
const { skipIfNoData, isRecentTimestamp } = require('../utils/test-helpers');
const config = require('../config/test-config');

describe('RT Hot Data API', () => {
  const client = new RtApiClient();

  describe('Status Endpoint', () => {
    test('GET /api/v1/rt/status should return operational status', async () => {
      const response = await client.getStatus();
      
      client.validateJsonResponse(response);
      expect(response.data).toHaveProperty('status');
      expect(response.data.status).toBe('operational');
    });

    test('Status should include hot_data information', async () => {
      const response = await client.getStatus();
      
      client.validateJsonResponse(response);
      expect(response.data).toHaveProperty('hot_data');
      expect(response.data.hot_data).toHaveProperty('trip_updates');
      expect(response.data.hot_data).toHaveProperty('vehicle_positions');
    });
  });

  describe('Current Trip Updates', () => {
    test('GET /api/v1/rt/current should return trip updates', async () => {
      const response = await client.getCurrent({ provider: config.defaultProvider });
      
      if (skipIfNoData(response, 'current trip updates')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(response.data).toHaveProperty('trip_updates');
      expect(Array.isArray(response.data.trip_updates)).toBe(true);
    });

    test('GET /api/v1/rt/current?route_id should filter by route', async () => {
      const response = await client.getCurrent({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId
      });
      
      if (skipIfNoData(response, 'trip updates by route')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(response.data).toHaveProperty('trip_updates');
    });

    test('GET /api/v1/rt/current?stop_id should filter by stop', async () => {
      const response = await client.getCurrent({ 
        provider: config.defaultProvider, 
        stop_id: config.testStopId
      });
      
      if (skipIfNoData(response, 'trip updates by stop')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(response.data).toHaveProperty('trip_updates');
    });

    test('Trip updates should have valid structure', async () => {
      const response = await client.getCurrent({ provider: config.defaultProvider });
      
      if (skipIfNoData(response, 'trip updates structure')) {
        return;
      }

      if (response.data.trip_updates && response.data.trip_updates.length > 0) {
        const update = response.data.trip_updates[0];
        expect(update).toHaveProperty('trip_id');
        expect(update).toHaveProperty('route_id');
      }
    });
  });

  describe('Vehicle Positions', () => {
    test('GET /api/v1/rt/positions should return vehicle positions', async () => {
      const response = await client.getPositions({ provider: config.defaultProvider });
      
      if (skipIfNoData(response, 'vehicle positions')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
    });

    test('GET /api/v1/rt/positions?route_id should filter by route', async () => {
      const response = await client.getPositions({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId
      });
      
      if (skipIfNoData(response, 'positions by route')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
    });

    test('GET /api/v1/rt/positions?vehicle_id should filter by vehicle', async () => {
      // First get a vehicle_id from positions
      const allPositions = await client.getPositions({ provider: config.defaultProvider });
      
      if (skipIfNoData(allPositions, 'positions by vehicle')) {
        return;
      }

      if (Array.isArray(allPositions.data) && allPositions.data.length > 0) {
        const vehicleId = allPositions.data[0].vehicle_id;
        const response = await client.getPositions({ 
          provider: config.defaultProvider, 
          vehicle_id: vehicleId
        });
        
        client.validateJsonResponse(response);
        expect(Array.isArray(response.data)).toBe(true);
      }
    });

    test('Vehicle positions should have valid structure', async () => {
      const response = await client.getPositions({ provider: config.defaultProvider });
      
      if (skipIfNoData(response, 'positions structure')) {
        return;
      }

      if (Array.isArray(response.data) && response.data.length > 0) {
        const position = response.data[0];
        expect(position).toHaveProperty('vehicle_id');
        expect(position).toHaveProperty('latitude');
        expect(position).toHaveProperty('longitude');
      }
    });
  });

  describe('GeoJSON Positions', () => {
    test('GET /api/v1/rt/geojson/positions should return GeoJSON', async () => {
      const { validateGeoJson } = require('../utils/test-helpers');
      const response = await client.getGeoJsonPositions({ provider: config.defaultProvider });
      
      if (skipIfNoData(response, 'GeoJSON positions')) {
        return;
      }

      client.validateJsonResponse(response);
      validateGeoJson(response.data);
    });
  });

  describe('Timestamp Validation', () => {
    test('Hot data timestamps should be recent (within 24h)', async () => {
      const response = await client.getPositions({ provider: config.defaultProvider });
      
      if (skipIfNoData(response, 'timestamp validation')) {
        return;
      }

      if (Array.isArray(response.data) && response.data.length > 0) {
        const position = response.data[0];
        if (position.timestamp) {
          const isRecent = isRecentTimestamp(position.timestamp);
          expect(isRecent).toBe(true);
        }
      }
    });
  });

  describe('Data Structure Validation', () => {
    test('Trip updates should include required fields', async () => {
      const response = await client.getCurrent({ provider: config.defaultProvider });
      
      if (skipIfNoData(response, 'trip updates fields')) {
        return;
      }

      if (response.data.trip_updates && response.data.trip_updates.length > 0) {
        const update = response.data.trip_updates[0];
        expect(update).toHaveProperty('trip_id');
        expect(update).toHaveProperty('route_id');
      }
    });

    test('Vehicle positions should include location data', async () => {
      const response = await client.getPositions({ provider: config.defaultProvider });
      
      if (skipIfNoData(response, 'positions location data')) {
        return;
      }

      if (Array.isArray(response.data) && response.data.length > 0) {
        const position = response.data[0];
        expect(position).toHaveProperty('latitude');
        expect(position).toHaveProperty('longitude');
        expect(typeof position.latitude).toBe('number');
        expect(typeof position.longitude).toBe('number');
      }
    });
  });
});

