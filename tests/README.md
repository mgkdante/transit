# API Test Suite

Comprehensive test suite for the Transit Data Pipeline APIs using Jest.

## Structure

```
tests/
├── api/                    # API endpoint tests
│   ├── static-api.test.js
│   ├── static-geojson.test.js
│   ├── rt-hot.test.js
│   ├── rt-historical.test.js
│   └── analytics.test.js
├── integration/            # Integration tests
│   └── data-flow.test.js
├── utils/                  # Test utilities
│   ├── api-client.js
│   └── test-helpers.js
├── config/                 # Test configuration
│   └── test-config.js
├── fixtures/               # Test data fixtures
│   ├── routes.json
│   ├── stops.json
│   └── ...
└── setup.js               # Jest setup file
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run tests with coverage
```bash
npm run test:coverage
```

### Run specific test file
```bash
npm test -- tests/api/static-api.test.js
```

### Run tests matching a pattern
```bash
npm test -- --testNamePattern="Static API"
```

## Configuration

Test configuration is in `tests/config/test-config.js`. You can override API URLs via environment variables:

```bash
STATIC_API_URL=https://your-static-api.workers.dev npm test
RT_API_URL=https://your-rt-api.workers.dev npm test
```

## Test Utilities

### ApiClient
Base class for making HTTP requests to APIs. Includes retry logic and response validation.

### Test Helpers
- `skipIfNoData()` - Skip tests when no data is available
- `validateGeoJson()` - Validate GeoJSON structure
- `validateCoordinates()` - Validate coordinate ranges
- `validateDateFormat()` - Validate date formats
- `isRecentTimestamp()` - Check if timestamp is within 24h

## Test Coverage

Tests cover:
- ✅ Static API endpoints (routes, stops, trips, shapes)
- ✅ Static GeoJSON endpoints
- ✅ RT hot data endpoints (current trip updates, positions)
- ✅ RT historical aggregation endpoints
- ✅ Analytics endpoints (delays, OTP, peak hours)
- ✅ Integration tests (data flow, cross-endpoint consistency)
- ✅ Error handling
- ✅ Data validation

## CI/CD

Tests run automatically on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`

Coverage reports are uploaded as artifacts.

## Notes

- Tests gracefully skip when no data is available (useful for CI)
- Tests use real API endpoints (not mocks)
- Timeout is set to 30 seconds for API calls
- Retry logic handles transient failures

