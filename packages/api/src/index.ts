import express from 'express';
import cors from 'cors';
import { createExecutionRoutes } from './routes/execution.js';
import { createGodfatherRoutes } from './routes/godfather.js';

import type { ExecutionRepository, GodfatherRepository } from '@mev-research/database';
import type { WalletManager, RiskEngine } from '@mev-research/execution';

export { createExecutionRoutes } from './routes/execution.js';
export { createGodfatherRoutes } from './routes/godfather.js';

export function createApiServer(
  executionRepo: ExecutionRepository,
  walletManager: WalletManager,
  riskEngine: RiskEngine,
  port: number = 3001,
  godfatherRepo?: GodfatherRepository,
  godfatherEngine?: any,
): { start: () => void; stop: () => void } {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use('/api/v1/execution', createExecutionRoutes(executionRepo, walletManager, riskEngine));

  if (godfatherRepo) {
    app.use('/api/v1/godfather', createGodfatherRoutes(godfatherRepo, godfatherEngine));
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const server = app.listen(port, () => {
    console.log(`[API] Server listening on http://localhost:${port}`);
  });

  return {
    start: () => { /* already started above */ },
    stop: () => server.close(),
  };
}

