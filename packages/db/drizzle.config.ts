import { loadDatabaseConfig, loadRootEnvFile } from '@solaryna/config';
import { defineConfig } from 'drizzle-kit';

loadRootEnvFile();
const { databaseUrl } = loadDatabaseConfig(process.env);

export default defineConfig({
  dialect: 'mysql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: databaseUrl.reveal() },
  strict: true,
  verbose: true,
});
