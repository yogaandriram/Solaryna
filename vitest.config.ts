import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/{src,test}/**/*.test.ts'],
    environment: 'node',
    // Database test files share one MySQL database and wipe it, so they must not run in parallel.
    fileParallelism: process.env.TEST_DATABASE_URL === undefined,
  },
});
