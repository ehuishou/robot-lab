// Test mode is available only through an explicit URL parameter. No UI entry.
export const TEST_MODE = typeof document !== 'undefined' && new URLSearchParams(location.search).get('test') === '1';
