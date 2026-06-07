import http from 'http';
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

// Counters
export const opportunitiesDetected = new Counter({
  name: 'mev_opportunities_detected_total',
  help: 'Total number of arbitrage opportunities detected',
  labelNames: ['pair', 'buy_dex', 'sell_dex'],
  registers: [registry],
});

export const tradesExecuted = new Counter({
  name: 'mev_trades_executed_total',
  help: 'Total number of trade bundles submitted',
  labelNames: ['status'],
  registers: [registry],
});

export const simulationsRun = new Counter({
  name: 'mev_simulations_total',
  help: 'Total simulations run',
  labelNames: ['result'],
  registers: [registry],
});

// Gauges
export const walletSolBalance = new Gauge({
  name: 'mev_wallet_sol_balance',
  help: 'Current SOL balance of bot wallet',
  registers: [registry],
});

export const walletUsdcBalance = new Gauge({
  name: 'mev_wallet_usdc_balance',
  help: 'Current USDC balance of bot wallet',
  registers: [registry],
});

export const dailyPnlUsdc = new Gauge({
  name: 'mev_daily_pnl_usdc',
  help: 'Running daily P&L in USDC',
  registers: [registry],
});

export const killSwitchActive = new Gauge({
  name: 'mev_kill_switch_active',
  help: '1 when the kill switch is active, 0 otherwise',
  registers: [registry],
});

// Histograms
export const detectionLatency = new Histogram({
  name: 'mev_detection_latency_ms',
  help: 'Latency from account update to opportunity detection in ms',
  buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  registers: [registry],
});

export const bundleSubmissionDuration = new Histogram({
  name: 'mev_bundle_submission_duration_ms',
  help: 'Duration of Jito bundle submission to confirmation in ms',
  buckets: [100, 500, 1000, 2000, 5000, 10000, 30000],
  registers: [registry],
});

let server: http.Server | null = null;

export function startMetricsServer(port: number = 9091): void {
  server = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': registry.contentType });
      res.end(await registry.metrics());
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => {
    console.log(`[Monitoring] Prometheus metrics at http://localhost:${port}/metrics`);
  });
}

export function stopMetricsServer(): void {
  server?.close();
}
