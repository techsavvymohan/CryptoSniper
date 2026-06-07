import express, { Router } from 'express';
import { ExecutionRepository, cacheGet } from '@mev-research/database';
import { WalletManager, RiskEngine } from '@mev-research/execution';

export function createExecutionRoutes(
  executionRepo: ExecutionRepository,
  walletManager: WalletManager,
  riskEngine: RiskEngine,
): Router {
  const router = express.Router();

  const adminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const adminKey = req.header('X-Admin-Key');
    if (adminKey !== process.env.TELEGRAM_ADMIN_CHAT_ID) {
      return res.status(403).json({ error: 'Unauthorized: Admin key mismatch' });
    }
    next();
  };

  router.get('/orders', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const orders = await executionRepo.getRecentOrders(limit);
    res.json(orders);
  });

  router.get('/orders/:id', async (req, res) => {
    const order = await executionRepo.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  });

  router.get('/pnl', async (req, res) => {
    const days = parseInt(req.query.days as string) || 7;
    const pnl = await executionRepo.getPnL(days);
    res.json(pnl);
  });

  router.get('/wallet', async (req, res) => {
    const state = walletManager.getCurrentState();
    res.json({
      address: walletManager.getPublicKey().toBase58(),
      ...state
    });
  });

  router.post('/kill-switch', adminAuth, async (req, res) => {
    const reason = req.body.reason || 'Manual trigger';
    await riskEngine.triggerKillSwitch(reason);
    res.json({ status: 'Kill switch activated', reason });
  });

  router.delete('/kill-switch', adminAuth, async (req, res) => {
    await riskEngine.releaseKillSwitch();
    res.json({ status: 'Kill switch released' });
  });

  router.get('/status', async (_req, res) => {
    let killSwitchActive = false;
    try {
      const val = await cacheGet('execution:kill-switch');
      killSwitchActive = val !== null;
    } catch {
      killSwitchActive = false;
    }
    const wallet = walletManager.getCurrentState();
    res.json({
      killSwitchActive,
      simulationMode: process.env['SIMULATION_MODE'] === 'true',
      wallet,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
