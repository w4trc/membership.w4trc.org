import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Only applies migrations that have not been applied yet, so this is safe to
// run before every test file.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
