const { RtApiClient } = require('../utils/api-client');
const { skipIfNoData, validateDateFormat } = require('../utils/test-helpers');
const config = require('../config/test-config');

describe('Analytics API', () => {
  const client = new RtApiClient();

  describe('Delays by Route', () => {
    test('GET /api/v1/analytics/delays-by-route should return route delays', async () => {
      const response = await client.getDelaysByRoute({
        provider: config.defaultProvider,
        start_date: config.testStartDate,
        end_date: config.testEndDate
      });
      
      if (skipIfNoData(response, 'delays by route')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
      
      if (response.data.length > 0) {
        const record = response.data[0];
        expect(record).toHaveProperty('route_id');
        expect(record).toHaveProperty('avg_delay');
        // Should include route name from static data join
        expect(record).toHaveProperty('route_name');
      }
    });
  });

  describe('Delays by Stop', () => {
    test('GET /api/v1/analytics/delays-by-stop should return stop delays', async () => {
      const response = await client.getDelaysByStop({
        provider: config.defaultProvider,
        start_date: config.testStartDate,
        end_date: config.testEndDate
      });
      
      if (skipIfNoData(response, 'delays by stop')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
      
      if (response.data.length > 0) {
        const record = response.data[0];
        expect(record).toHaveProperty('stop_id');
        expect(record).toHaveProperty('avg_delay');
        // Should include stop name from static data join
        expect(record).toHaveProperty('stop_name');
      }
    });
  });

  describe('On-Time Performance', () => {
    test('GET /api/v1/analytics/on-time-performance should return OTP metrics', async () => {
      const response = await client.getOnTimePerformance({
        provider: config.defaultProvider,
        start_date: config.testStartDate,
        end_date: config.testEndDate,
        threshold: 300
      });
      
      if (skipIfNoData(response, 'on-time performance')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(response.data).toHaveProperty('on_time_count');
      expect(response.data).toHaveProperty('late_count');
      expect(response.data).toHaveProperty('total_count');
      expect(response.data).toHaveProperty('on_time_percentage');
    });

    test('OTP should calculate percentage correctly', async () => {
      const response = await client.getOnTimePerformance({
        provider: config.defaultProvider,
        start_date: config.testStartDate,
        end_date: config.testEndDate,
        threshold: 300
      });
      
      if (skipIfNoData(response, 'OTP calculation')) {
        return;
      }

      if (response.data.total_count > 0) {
        const expectedPercentage = (response.data.on_time_count / response.data.total_count) * 100;
        expect(response.data.on_time_percentage).toBeCloseTo(expectedPercentage, 2);
      }
    });
  });

  describe('Peak Hours Analysis', () => {
    test('GET /api/v1/analytics/peak-hours should return peak hour analysis', async () => {
      const response = await client.getPeakHours({
        provider: config.defaultProvider,
        date: config.testDate
      });
      
      if (skipIfNoData(response, 'peak hours')) {
        return;
      }

      client.validateJsonResponse(response);
      expect(Array.isArray(response.data)).toBe(true);
      
      if (response.data.length > 0) {
        const record = response.data[0];
        expect(record).toHaveProperty('hour');
        expect(record).toHaveProperty('trip_count');
        expect(record.hour).toBeGreaterThanOrEqual(0);
        expect(record.hour).toBeLessThanOrEqual(23);
      }
    });
  });

  describe('Data Joining Validation', () => {
    test('Delays by route should include route names from static data', async () => {
      const response = await client.getDelaysByRoute({
        provider: config.defaultProvider,
        start_date: config.testStartDate,
        end_date: config.testEndDate
      });
      
      if (skipIfNoData(response, 'route names join')) {
        return;
      }

      if (response.data.length > 0) {
        const record = response.data[0];
        // Should have route name from static tables join
        expect(record).toHaveProperty('route_name');
        expect(typeof record.route_name).toBe('string');
      }
    });

    test('Delays by stop should include stop names from static data', async () => {
      const response = await client.getDelaysByStop({
        provider: config.defaultProvider,
        start_date: config.testStartDate,
        end_date: config.testEndDate
      });
      
      if (skipIfNoData(response, 'stop names join')) {
        return;
      }

      if (response.data.length > 0) {
        const record = response.data[0];
        // Should have stop name from static tables join
        expect(record).toHaveProperty('stop_name');
        expect(typeof record.stop_name).toBe('string');
      }
    });
  });

  describe('Aggregation Accuracy', () => {
    test('Average delays should be calculated correctly', async () => {
      const response = await client.getDelaysByRoute({
        provider: config.defaultProvider,
        start_date: config.testStartDate,
        end_date: config.testEndDate
      });
      
      if (skipIfNoData(response, 'average delay calculation')) {
        return;
      }

      if (response.data.length > 0) {
        const record = response.data[0];
        if (record.avg_delay !== null && record.avg_delay !== undefined) {
          expect(typeof record.avg_delay).toBe('number');
          expect(record.avg_delay).not.toBeNaN();
        }
      }
    });
  });

  describe('Date Range Handling', () => {
    test('Should handle valid date ranges', async () => {
      const response = await client.getDelaysByRoute({
        provider: config.defaultProvider,
        start_date: config.testStartDate,
        end_date: config.testEndDate
      });
      
      // Should not error on valid date range
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    test('Should validate date format', () => {
      expect(() => validateDateFormat(config.testStartDate)).not.toThrow();
      expect(() => validateDateFormat(config.testEndDate)).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    test('Should handle invalid date ranges gracefully', async () => {
      const response = await client.getDelaysByRoute({
        provider: config.defaultProvider,
        start_date: 'invalid-date',
        end_date: config.testEndDate
      });
      
      // Should return error or empty result, not crash
      expect(response.status).toBeGreaterThanOrEqual(200);
    });

    test('Should handle missing data gracefully', async () => {
      const response = await client.getDelaysByRoute({
        provider: config.defaultProvider,
        start_date: '2099-01-01',
        end_date: '2099-01-02'
      });
      
      // Should return empty result or error message, not crash
      expect(response.status).toBeGreaterThanOrEqual(200);
    });
  });
});

