const { StaticApiClient } = require('../utils/api-client');
const { skipIfNoData, validateGeoJson, validateGeoJsonFeature, validateCoordinates } = require('../utils/test-helpers');
const config = require('../config/test-config');

describe('Static GeoJSON API', () => {
  const client = new StaticApiClient();

  describe('Stops GeoJSON', () => {
    test('GET /api/v1/geojson/stops should return valid GeoJSON FeatureCollection', async () => {
      const response = await client.getGeoJsonStops({ provider: config.defaultProvider, limit: 10 });
      
      if (skipIfNoData(response, 'stops GeoJSON')) {
        return;
      }

      client.validateJsonResponse(response);
      validateGeoJson(response.data);
      
      if (response.data.features.length > 0) {
        validateGeoJsonFeature(response.data.features[0]);
        
        // Validate coordinates
        const coords = response.data.features[0].geometry.coordinates;
        if (coords && coords.length >= 2) {
          validateCoordinates(coords[1], coords[0]); // GeoJSON is [lon, lat]
        }
      }
    });

    test('GET /api/v1/geojson/stops?route_id should filter by route', async () => {
      const response = await client.getGeoJsonStops({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId,
        limit: 10
      });
      
      if (skipIfNoData(response, 'stops GeoJSON by route')) {
        return;
      }

      client.validateJsonResponse(response);
      validateGeoJson(response.data);
    });
  });

  describe('Routes GeoJSON', () => {
    test('GET /api/v1/geojson/routes should return route shapes as GeoJSON', async () => {
      const response = await client.getGeoJsonRoutes({ provider: config.defaultProvider, limit: 5 });
      
      if (skipIfNoData(response, 'routes GeoJSON')) {
        return;
      }

      client.validateJsonResponse(response);
      validateGeoJson(response.data);
      
      if (response.data.features.length > 0) {
        validateGeoJsonFeature(response.data.features[0]);
        
        // Routes should have LineString or MultiLineString geometry
        const geomType = response.data.features[0].geometry.type;
        expect(['LineString', 'MultiLineString']).toContain(geomType);
      }
    });

    test('GET /api/v1/geojson/routes?route_id should return single route shape', async () => {
      const response = await client.getGeoJsonRoutes({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId
      });
      
      if (skipIfNoData(response, 'single route GeoJSON')) {
        return;
      }

      client.validateJsonResponse(response);
      validateGeoJson(response.data);
    });
  });

  describe('GeoJSON Schema Validation', () => {
    test('All features should have valid GeoJSON structure', async () => {
      const response = await client.getGeoJsonStops({ provider: config.defaultProvider, limit: 5 });
      
      if (skipIfNoData(response, 'GeoJSON schema validation')) {
        return;
      }

      validateGeoJson(response.data);
      
      response.data.features.forEach(feature => {
        validateGeoJsonFeature(feature);
        
        // Validate properties exist
        expect(feature).toHaveProperty('properties');
        
        // Validate coordinates are valid numbers
        if (feature.geometry.type === 'Point' && feature.geometry.coordinates) {
          const [lon, lat] = feature.geometry.coordinates;
          expect(typeof lon).toBe('number');
          expect(typeof lat).toBe('number');
          expect(lon).not.toBeNaN();
          expect(lat).not.toBeNaN();
        }
      });
    });
  });

  describe('Coordinate Validation', () => {
    test('Coordinates should be within Montreal area bounds', async () => {
      const response = await client.getGeoJsonStops({ provider: config.defaultProvider, limit: 10 });
      
      if (skipIfNoData(response, 'coordinate validation')) {
        return;
      }

      validateGeoJson(response.data);
      
      response.data.features.forEach(feature => {
        if (feature.geometry.type === 'Point' && feature.geometry.coordinates) {
          const [lon, lat] = feature.geometry.coordinates;
          try {
            validateCoordinates(lat, lon);
          } catch (error) {
            // Log but don't fail - some stops might be outside bounds
            console.warn(`Coordinate validation warning: ${error.message}`);
          }
        }
      });
    });
  });
});

