import express, { Router } from 'express';
import type { GodfatherRepository } from '@mev-research/database';

export function createGodfatherRoutes(
  godfatherRepo: GodfatherRepository,
  godfatherEngine?: any,
): Router {
  const router = express.Router();

  /**
   * GET /api/v1/godfather/signals
   * Returns recent institutional SMC signals detected by the Godfather engine.
   */
  router.get('/signals', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const symbol = req.query.symbol as string | undefined;

      let signals = await godfatherRepo.getRecentSignals(limit);
      if (symbol) {
        signals = signals.filter(s => s.symbol.toUpperCase() === symbol.toUpperCase());
      }
      res.json(signals);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve signals', message: err.message });
    }
  });

  /**
   * GET /api/v1/godfather/trades
   * Returns active open trades and historical completed trades with 3-tranche telemetry.
   */
  router.get('/trades', async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const limit = parseInt(req.query.limit as string, 10) || 50;

      if (status === 'OPEN') {
        const openTrades = await godfatherRepo.getOpenTrades();
        return res.json(openTrades);
      }

      const allTrades = await godfatherRepo.getRecentTrades(limit);
      if (status) {
        return res.json(allTrades.filter(t => t.status === status));
      }
      res.json(allTrades);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve trades', message: err.message });
    }
  });

  /**
   * GET /api/v1/godfather/footprint/:symbol
   * Returns real-time sub-second footprint snapshot (VWAP, Delta VWAP, CVD, OBI).
   */
  router.get('/footprint/:symbol', async (req, res) => {
    try {
      const symbol = req.params.symbol;
      const snapshot = godfatherEngine?.getFootprintSnapshot
        ? godfatherEngine.getFootprintSnapshot(symbol)
        : null;

      if (!snapshot) {
        return res.status(404).json({ error: `Footprint data not available for ${symbol}` });
      }
      res.json(snapshot);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve footprint', message: err.message });
    }
  });

  /**
   * GET /api/v1/godfather/status
   * Returns operational telemetry, today's realized PnL, pending orders, and open positions.
   */
  router.get('/status', async (_req, res) => {
    try {
      const todayPnl = await godfatherRepo.getDailyPnl(new Date());
      const openTrades = await godfatherRepo.getOpenTrades();

      const pendingOrders = godfatherEngine?.getPendingSignals
        ? godfatherEngine.getPendingSignals()
        : [];

      const btcFootprint = godfatherEngine?.getFootprintSnapshot
        ? godfatherEngine.getFootprintSnapshot('BTC')
        : null;
      const solFootprint = godfatherEngine?.getFootprintSnapshot
        ? godfatherEngine.getFootprintSnapshot('SOL')
        : null;

      res.json({
        status: 'ACTIVE',
        dailyPnlUsd: todayPnl,
        openPositionsCount: openTrades.length,
        openTrades,
        pendingOrdersCount: pendingOrders.length,
        pendingOrders,
        footprint: {
          BTC: btcFootprint,
          SOL: solFootprint,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve status', message: err.message });
    }
  });

  return router;
}
