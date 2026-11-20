// Loaded with --import before any test file: point the app at the test database.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Refusing to run tests against the dev database.');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_RATE_LIMIT = '1000';
process.env.PRESENCE_GRACE_MS = '50';
process.env.BCRYPT_COST = '4'; // fast hashing in tests only
process.env.S3_BUCKET = 'chat-media-test';
