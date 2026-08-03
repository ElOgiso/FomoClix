/**
 * Shared runtime config for API connectivity.
 *
 * IMPORTANT: VITE_API_BASE_URL must point at the Express backend (Cloud Run
 * zora-bot-service), NOT AI Studio preview hosts (ais-dev / ais-pre), which
 * only serve HTML cookie-check pages and break Google/wallet login.
 */
const PRODUCTION_API =
  'https://zora-bot-service-208995792653.us-central1.run.app';

export const API_BASE_URL = (() => {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  const base = fromEnv || PRODUCTION_API;
  return base.endsWith('/') ? base.slice(0, -1) : base;
})();

export const ALLOW_MOCK_MODE =
  String(import.meta.env.VITE_ALLOW_MOCK_MODE ?? 'false').toLowerCase() === 'true';
