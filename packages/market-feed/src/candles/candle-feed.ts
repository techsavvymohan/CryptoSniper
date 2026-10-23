import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { Candle, Timeframe } from '@mev-research/shared';
import { CausalMultiTFResampler, ResampleResult } from './resampler.js';

export interface CandleFeedEvents {
  candle: (resample: ResampleResult) => void;
  connected: () => void;
  disconnected: () => void;
  error: (err: Error) => void;
}

export class CryptoCandleFeedService extends EventEmitter {
  private resampler: CausalMultiTFResampler;
  private symbols: string[];
  private ws: any = null;
  private isRunning = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private backoffMs = 1000;

  constructor(symbols = ['BTCUSD', 'SOLUSD'], maxBufferSize = 500) {
    super();
    this.symbols = symbols;
    this.resampler = new CausalMultiTFResampler(maxBufferSize);
  }

  public getResampler(): CausalMultiTFResampler {
    return this.resampler;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.backfillRecentCandles();
    this.connectWebSocket();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close error
      }
      this.ws = null;
    }
    this.emit('disconnected');
  }

  /**
   * Allows external injection of historical or simulated M1 bars.
   */
  public injectCandle(candle: Candle): ResampleResult {
    const res = this.resampler.addM1Candle(candle);
    this.emit('candle', res);
    return res;
  }

  private mapSymbolToStream(symbol: string): string {
    let clean = symbol.toLowerCase().replace(/[-_]/g, '');
    if (clean.endsWith('usd') && !clean.endsWith('usdt')) {
      clean = clean.replace('usd', 'usdt');
    } else if (!clean.endsWith('usdt')) {
      clean = `${clean}usdt`;
    }
    return clean;
  }

  private mapStreamToStandardSymbol(stream: string): string {
    const clean = stream.toUpperCase();
    if (clean.endsWith('USDT')) {
      return clean.replace('USDT', 'USD');
    }
    return clean;
  }

  private async backfillRecentCandles(): Promise<void> {
    for (const symbol of this.symbols) {
      const binanceSymbol = this.mapSymbolToStream(symbol).toUpperCase();
      try {
        // Fetch last 100 M1 candles from Binance public REST endpoint
        const res = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${binanceSymbol}&interval=1m&limit=100`,
        );
        if (!res.ok) continue;

        const data = (await res.json()) as any[];
        for (const item of data) {
          const candle: Candle = {
            symbol,
            timeframe: 'M1',
            openTime: item[0],
            open: parseFloat(item[1]),
            high: parseFloat(item[2]),
            low: parseFloat(item[3]),
            close: parseFloat(item[4]),
            volume: parseFloat(item[5]),
            closeTime: item[6],
            isClosed: true,
          };
          this.resampler.addM1Candle(candle);
        }
      } catch {
        // Backfill error non-critical, will resume on live stream
      }
    }
  }

  private connectWebSocket(): void {
    if (!this.isRunning) return;

    try {
      const streams = this.symbols
        .map(s => `${this.mapSymbolToStream(s)}@kline_1m`)
        .join('/');

      const url = `wss://fstream.binance.com/stream?streams=${streams}`;

      // Use global WebSocket or ws library fallback for Node 20 LTS
      const WS = (globalThis as any).WebSocket || WebSocket;
      this.ws = new WS(url);

      this.ws.onopen = () => {
        this.backoffMs = 1000;
        this.emit('connected');
      };

      this.ws.onmessage = (event: any) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data.toString();
          const parsed = JSON.parse(raw);
          const k = parsed.data?.k;
          if (!k) return;

          // Only process closed candles to eliminate look-ahead repainting!
          if (!k.x) return;

          const symbol = this.mapStreamToStandardSymbol(k.s);
          const candle: Candle = {
            symbol,
            timeframe: 'M1',
            openTime: k.t,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            closeTime: k.T,
            isClosed: true,
          };

          const resampleResult = this.resampler.addM1Candle(candle);
          this.emit('candle', resampleResult);
        } catch (err) {
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      };

      this.ws.onerror = (err: any) => {
        this.emit('error', new Error(`WebSocket error: ${err.message || 'connection failed'}`));
      };

      this.ws.onclose = () => {
        this.emit('disconnected');
        if (this.isRunning) {
          this.reconnectTimeout = setTimeout(() => {
            this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
            this.connectWebSocket();
          }, this.backoffMs);
        }
      };
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      if (this.isRunning) {
        this.reconnectTimeout = setTimeout(() => this.connectWebSocket(), 5000);
      }
    }
  }
}
