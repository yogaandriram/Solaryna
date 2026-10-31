import 'server-only';
import { loadWebConfig, loadWebEnv, type WebConfig } from '@solaryna/config';

let config: WebConfig | undefined;

/** The web config, read once from the root .env (only the dashboard's own keys). */
export function getWebConfig(): WebConfig {
  config ??= loadWebConfig(loadWebEnv());
  return config;
}
