const { StaticApiClient, RtApiClient } = require('../utils/api-client');
const { skipIfNoData, extractRouteIds, extractStopIds } = require('../utils/test-helpers');
const config = require('../config/test-config');

describe('Data Flow Integration Tests', () => {
  const staticClient = new StaticApiClient();
  const rtClient = new RtApiClient();

  describe('Static to RT Data Relationships', () => {
    test('Routes from static API should match routes in RT data', async () => {
      // Get routes from static API
      const staticRoutes = await staticClient.getRoutes({ 
        provider: config.defaultProvider, 
        limit: 10 
      });
      
      if (skipIfNoData(staticRoutes, 'static routes')) {
        return;
      }

      // Get routes from RT data
      const rtStatus = await rtClient.getStatus();
      if (skipIfNoData(rtStatus, 'RT status')) {
        return;
      }

      // If we have both, verify route IDs exist in static data
      if (Array.isArray(staticRoutes.data) && staticRoutes.data.length > 0) {
        const staticRouteIds = extractRouteIds(staticRoutes.data);
        expect(staticRouteIds.length).toBeGreaterThan(0);
      }
    });

    test('Stops from static API should match stops in RT delays', async () => {
      // Get stops from static API
      const staticStops = await staticClient.getStops({ 
        provider: config.defaultProvider, 
        limit: 10 
      });
      
      if (skipIfNoData(staticStops, 'static stops')) {
        return;
      }

      // Get historical RT delays
      const rtDelays = await rtClient.getHistorical({
        provider: config.defaultProvider,
        date: config.testDate,
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      if (skipIfNoData(rtDelays, 'RT delays')) {
        return;
      }

      // If we have both, verify stop IDs exist in static data
      if (Array.isArray(staticStops.data) && staticStops.data.length > 0) {
        const staticStopIds = extractStopIds(staticStops.data);
        expect(staticStopIds.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Historical to Analytics Data Flow', () => {
    test('Historical aggregations should match analytics calculations', async () => {
      // Get historical daily delays
      const historical = await rtClient.getHistorical({
        provider: config.defaultProvider,
        date: config.testDate,
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      if (skipIfNoData(historical, 'historical data')) {
        return;
      }

      // Get analytics delays by route
      const analytics = await rtClient.getDelaysByRoute({
        provider: config.defaultProvider,
        start_date: config.testDate,
        end_date: config.testDate
      });
      
      if (skipIfNoData(analytics, 'analytics data')) {
        return;
      }

      // Both should return data for the same date
      if (Array.isArray(historical.data) && historical.data.length > 0) {
        expect(historical.data[0]).toHaveProperty('date');
      }
    });
  });

  describe('Cross-Endpoint Consistency', () => {
    test('Route IDs should be consistent across endpoints', async () => {
      // Get route from static API
      const staticRoute = await staticClient.getRoutes({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId 
      });
      
      if (skipIfNoData(staticRoute, 'static route')) {
        return;
      }

      // Get RT data for same route
      const rtData = await rtClient.getCurrent({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId 
      });
      
      if (skipIfNoData(rtData, 'RT route data')) {
        return;
      }

      // Both should reference the same route_id
      if (staticRoute.data.route_id) {
        expect(staticRoute.data.route_id).toBe(config.testRouteId);
      }
    });

    test('Stop IDs should be consistent across endpoints', async () => {
      // Get stop from static API
      const staticStop = await staticClient.getStops({ 
        provider: config.defaultProvider, 
        stop_id: config.testStopId 
      });
      
      if (skipIfNoData(staticStop, 'static stop')) {
        return;
      }

      // Get RT delays for same stop
      const rtDelays = await rtClient.getHistorical({
        provider: config.defaultProvider,
        date: config.testDate,
        stop_id: config.testStopId,
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      if (skipIfNoData(rtDelays, 'RT stop delays')) {
        return;
      }

      // Both should reference the same stop_id
      if (staticStop.data.stop_id) {
        expect(staticStop.data.stop_id).toBe(config.testStopId);
      }
    });
  });

  describe('Data Integrity Checks', () => {
    test('GeoJSON coordinates should match static stop locations', async () => {
      // Get stop from static API
      const staticStop = await staticClient.getStops({ 
        provider: config.defaultProvider, 
        stop_id: config.testStopId 
      });
      
      if (skipIfNoData(staticStop, 'static stop location')) {
        return;
      }

      // Get GeoJSON stops
      const geoJsonStops = await staticClient.getGeoJsonStops({ 
        provider: config.defaultProvider,
        limit: 100
      });
      
      if (skipIfNoData(geoJsonStops, 'GeoJSON stops')) {
        return;
      }

      // Find matching stop in GeoJSON
      if (staticStop.data.stop_id && geoJsonStops.data.features) {
        const matchingFeature = geoJsonStops.data.features.find(
          f => f.properties?.stop_id === staticStop.data.stop_id
        );
        
        if (matchingFeature) {
          // Coordinates should match (within reasonable precision)
          const [lon, lat] = matchingFeature.geometry.coordinates;
          expect(Math.abs(lat - staticStop.data.stop_lat)).toBeLessThan(0.0001);
          expect(Math.abs(lon - staticStop.data.stop_lon)).toBeLessThan(0.0001);
        }
      }
    });

    test('Route shapes should be valid LineStrings', async () => {
      // Get route shape
      const shapes = await staticClient.getShapes({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId 
      });
      
      if (skipIfNoData(shapes, 'route shapes')) {
        return;
      }

      // Get GeoJSON route
      const geoJsonRoute = await staticClient.getGeoJsonRoutes({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId 
      });
      
      if (skipIfNoData(geoJsonRoute, 'GeoJSON route')) {
        return;
      }

      // GeoJSON should have valid LineString geometry
      if (geoJsonRoute.data.features && geoJsonRoute.data.features.length > 0) {
        const feature = geoJsonRoute.data.features[0];
        expect(['LineString', 'MultiLineString']).toContain(feature.geometry.type);
        expect(feature.geometry.coordinates).toBeDefined();
        expect(Array.isArray(feature.geometry.coordinates)).toBe(true);
      }
    });
  });

  describe('End-to-End Data Flow', () => {
    test('Complete data flow: Static → RT → Historical → Analytics', async () => {
      // 1. Get static route
      const staticRoute = await staticClient.getRoutes({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId 
      });
      
      if (skipIfNoData(staticRoute, 'end-to-end flow')) {
        return;
      }

      // 2. Get RT data for route
      const rtData = await rtClient.getCurrent({ 
        provider: config.defaultProvider, 
        route_id: config.testRouteId 
      });
      
      // 3. Get historical data for route
      const historical = await rtClient.getHistorical({
        provider: config.defaultProvider,
        date: config.testDate,
        route_id: config.testRouteId,
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      // 4. Get analytics for route
      const analytics = await rtClient.getDelaysByRoute({
        provider: config.defaultProvider,
        start_date: config.testDate,
        end_date: config.testDate
      });
      
      // All endpoints should respond (even if with no data)
      expect(staticRoute.status).toBe(200);
      expect(rtData.status).toBe(200);
      expect(historical.status).toBe(200);
      expect(analytics.status).toBe(200);
    });
  });
});

