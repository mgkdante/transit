// Jest setup file
// This file runs before all tests

// Increase timeout for all tests
jest.setTimeout(30000);

// Global test utilities
global.API_TIMEOUT = 30000;
global.RETRY_ATTEMPTS = 3;
global.RETRY_DELAY = 1000;

