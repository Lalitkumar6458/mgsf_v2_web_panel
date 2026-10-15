// Tests WIPE tables, so they only run against TEST_DATABASE_URL (never your real DATABASE_URL).
if (!process.env.TEST_DATABASE_URL) {
  console.error("Set TEST_DATABASE_URL (a separate, empty database) in .env to run tests.");
  process.exit(1);
}
if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  console.error("TEST_DATABASE_URL must be different from DATABASE_URL.");
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
