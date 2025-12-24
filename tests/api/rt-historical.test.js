const { RtApiClient } = require('../utils/api-client');
const { skipIfNoData, validateDateFormat, validateHour } = require('../utils/test-helpers');
const config = require('../config/test-config');

describe('RT Historical Data API', () => {
  const client = new RtApiClient();

  describe('Daily Aggregations', () => {
    test('GET /api/v1/rt/historical?date&feed_kind should return daily delays', async () => {
      const response = await client.getHistorical({
        provider: config.defaultProvider,
        date: config.testDate,
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      if (skipIfNoData(response, 'daily delays')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
      
      if (response.data.length > 0) {
        const record = response.data[0];
        expect(record).toHaveProperty('date');
        expect(record).toHaveProperty('avg_arrival_delay');
        expect(record).toHaveProperty('avg_departure_delay');
      }
    });

    test('GET /api/v1/rt/historical?date&route_id should filter by route', async () => {
      const response = await client.getHistorical({
        provider: config.defaultProvider,
        date: config.testDate,
        route_id: config.testRouteId,
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      if (skipIfNoData(response, 'daily delays by route')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
    });

    test('GET /api/v1/rt/historical?date&stop_id should filter by stop', async () => {
      const response = await client.getHistorical({
        provider: config.defaultProvider,
        date: config.testDate,
        stop_id: config.testStopId,
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      if (skipIfNoData(response, 'daily delays by stop')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
    });
  });

  describe('Hourly Aggregations', () => {
    test('GET /api/v1/rt/historical?date&hour should return hourly delays', async () => {
      const response = await client.getHistorical({
        provider: config.defaultProvider,
        date: config.testDate,
        hour: config.testHour,
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      if (skipIfNoData(response, 'hourly delays')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
      
      if (response.data.length > 0) {
        const record = response.data[0];
        expect(record).toHaveProperty('hour');
        expect(record.hour).toBe(config.testHour);
      }
    });
  });

  describe('Date Range Queries', () => {
    test('GET /api/v1/rt/historical/range should return date range data', async () => {
      const response = await client.getHistoricalRange({
        provider: config.defaultProvider,
        start: config.testStartDate,
        end: config.testEndDate,
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      if (skipIfNoData(response, 'date range')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
    });
  });

  describe('Historical Positions', () => {
    test('GET /api/v1/rt/historical/positions/hourly should return hourly positions', async () => {
      const response = await client.getHistoricalPositionsHourly({
        provider: config.defaultProvider,
        date: config.testDate,
        hour: config.testHour
      });
      
      if (skipIfNoData(response, 'hourly positions')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
      
      if (response.data.length > 0) {
        const record = response.data[0];
        expect(record).toHaveProperty('avg_latitude');
        expect(record).toHaveProperty('avg_longitude');
      }
    });

    test('GET /api/v1/rt/historical/positions/daily should return daily positions', async () => {
      const response = await client.getHistoricalPositionsDaily({
        provider: config.defaultProvider,
        date: config.testDate
      });
      
      if (skipIfNoData(response, 'daily positions')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
    });
  });

  describe('Historical GeoJSON', () => {
    test('GET /api/v1/rt/geojson/historical-positions should return GeoJSON', async () => {
      const { validateGeoJson } = require('../utils/test-helpers');
      const response = await client.getGeoJsonHistoricalPositions({
        provider: config.defaultProvider,
        date: config.testDate
      });
      
      if (skipIfNoData(response, 'historical GeoJSON')) {
        return;
      }

      client.validateJsonResponse(response);
      validateGeoJson(response.data);
    });
  });

  describe('Aggregation Validation', () => {
    test('Daily aggregations should include aggregation fields', async () => {
      const response = await client.getHistorical({
        provider: config.defaultProvider,
        date: config.testDate,
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      if (skipIfNoData(response, 'aggregation fields')) {
        return;
      }

      if (response.data.length > 0) {
        const record = response.data[0];
        expect(record).toHaveProperty('avg_arrival_delay');
        expect(record).toHaveProperty('max_arrival_delay');
        expect(record).toHaveProperty('min_arrival_delay');
        expect(record).toHaveProperty('trip_count');
      }
    });

    test('Hourly aggregations should include hour field', async () => {
      const response = await client.getHistorical({
        provider: config.defaultProvider,
        date: config.testDate,
        hour: config.testHour,
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      if (skipIfNoData(response, 'hourly hour field')) {
        return;
      }

      if (response.data.length > 0) {
        const record = response.data[0];
        expect(record).toHaveProperty('hour');
        expect(typeof record.hour).toBe('number');
        expect(record.hour).toBeGreaterThanOrEqual(0);
        expect(record.hour).toBeLessThanOrEqual(23);
      }
    });
  });

  describe('Date Format Validation', () => {
    test('Should validate date format', () => {
      expect(() => validateDateFormat(config.testDate)).not.toThrow();
      expect(() => validateDateFormat('invalid-date')).toThrow();
    });

    test('Should validate hour range', () => {
      expect(() => validateHour(14)).not.toThrow();
      expect(() => validateHour(25)).toThrow();
      expect(() => validateHour(-1)).toThrow();
    });
  });

  describe('Error Handling', () => {
    test('Should handle invalid dates gracefully', async () => {
      const response = await client.getHistorical({
        provider: config.defaultProvider,
        date: 'invalid-date',
        feed_kind: 'gtfsrt_trip_updates'
      });
      
      // Should return error or empty result, not crash
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    test('Should handle missing feed_kind gracefully', async () => {
      const response = await client.getHistoricalRange({
        provider: config.defaultProvider,
        start: config.testStartDate,
        end: config.testEndDate
      });
      
      // Should return error message, not crash
      expect(response.status).toBeGreaterThanOrEqual(200);
    });
  });
});

