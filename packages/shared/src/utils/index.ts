import { JITO_TIP_ACCOUNTS } from '../constants/index.js';

export function selectRandomJitoTipAccount(): string {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

export function generateId(): string {
  return crypto.randomUUID();
}

export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 5,
  baseDelayMs: number = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, 30_000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Helius HTTP RPC URL with API key query param. */
export function heliusRpcUrl(grpcHost: string, apiKey: string): string {
  const host = grpcHost.replace(/^https?:\/\//, '').replace(':443', '');
  return `https://${host}/?api-key=${apiKey}`;
}

export function isHeliusConfigured(apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  const lower = apiKey.toLowerCase();
  return (
    apiKey.length > 12 &&
    !lower.includes('your_') &&
    !lower.includes('add_later') &&
    !lower.includes('placeholder')
  );
}
