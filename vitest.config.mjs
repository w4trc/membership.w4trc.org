import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// Tests run inside the Workers runtime against a local D1 database built from
// the same migration files that `npm run db:migrate` applies.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'schema'));

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            STRIPE_SECRET_KEY: 'sk_test_vitest',
            STRIPE_WEBHOOK_SECRET: 'whsec_vitest',
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.js'],
      setupFiles: ['./test/apply-migrations.js'],
    },
  };
});
