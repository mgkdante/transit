// Test configuration
module.exports = {
  // API Base URLs
  staticApiUrl: process.env.STATIC_API_URL || 'https://transit-static-api-worker.long-block-0279.workers.dev',
  rtApiUrl: process.env.RT_API_URL || 'https://transit-rt-api-worker.long-block-0279.workers.dev',
  
  // Test provider
  defaultProvider: 'stm',
  
  // Test data
  testRouteId: '747',
  testStopId: '747-1',
  testTripId: null, // Will be set from actual data
  testVehicleId: null, // Will be set from actual data
  
  // Test dates (use recent dates that might have data)
  testDate: '2025-01-15',
  testStartDate: '2025-01-15',
  testEndDate: '2025-01-16',
  testHour: 14,
  
  // Timeouts
  apiTimeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
  
  // Test flags
  skipIfNoData: true, // Skip tests if no data available (for CI)
  
  // Montreal coordinates for testing
  montrealLat: 45.5017,
  montrealLon: -73.5673,
  testRadius: 1000 // meters
};

