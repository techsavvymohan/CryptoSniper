import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface TickPrint {
  symbol: string;
  price: number;
  size: number;
  side: 'BUY' | 'SELL';
  timestamp: number;
  hash?: string;
}

export interface OrderBookLevel {
  price: number;
  size: number;
  ordersCount?: number;
}

export interface FootprintSnapshot {
  symbol: string;
  currentPrice: number;
  vwap: number;
  deltaVwap: number;
  cvd: number;
  obi: number;
  delta1m: number;
  bidDepth5: number;
  askDepth5: number;
  isAbsorptionConfirmed: boolean;
  timestamp: number;
}

export interface HyperliquidFootprintConfig {
  wsUrl?: string;
  symbols?: string[];
  rollingWindowSecs?: number;
  obiDepth?: number;
}

export class HyperliquidFootprintService extends EventEmitter {
  private ws: any = null;
  private wsUrl: string;
  private symbols: string[];
  private rollingWindowMs: number;
  private obiDepth: number;
  private isRunning = false;
  private reconnectAttempt = 0;
  private pingInterval: NodeJS.Timeout | null = null;

  // Real-time state per coin (e.g., 'BTC', 'SOL')
  private recentTrades = new Map<string, TickPrint[]>();
  private cvdMap = new Map<string, number>();
  private orderBooks = new Map<string, { bids: OrderBookLevel[]; asks: OrderBookLevel[] }>();
  private lastPrices = new Map<string, number>();

  constructor(config: HyperliquidFootprintConfig = {}) {
    super();
    this.wsUrl = config.wsUrl ?? 'wss://api.hyperliquid.xyz/ws';
    this.symbols = (config.symbols ?? ['BTC', 'SOL']).map(s => this.normalizeSymbol(s));
    this.rollingWindowMs = (config.rollingWindowSecs ?? 60) * 1000;
    this.obiDepth = config.obiDepth ?? 5;
  }

  private normalizeSymbol(sym: string): string {
    const s = sym.toUpperCase().replace(/USD[TC]?$/, '').replace(/-PERP$/, '');
    return s === 'WBTC' ? 'BTC' : s;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.connect();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close error
      }
      this.ws = null;
    }
  }

  private connect(): void {
    if (!this.isRunning) return;

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        this.reconnectAttempt = 0;
        this.emit('connected');
        this.subscribe();
        this.startHeartbeat();
      });

      this.ws.on('message', (data: any) => {
        try {
          const raw = typeof data === 'string' ? data : data.toString();
          const msg = JSON.parse(raw);
          this.handleMessage(msg);
        } catch {
          // Ignore malformed message
        }
      });

      this.ws.on('error', (err: any) => {
        this.emit('error', err);
      });

      this.ws.on('close', () => {
        this.emit('disconnected');
        this.scheduleReconnect();
      });
    } catch (err: any) {
      this.emit('error', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.isRunning) return;
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    const delay = Math.min(500 * Math.pow(2, this.reconnectAttempt), 15_000);
    this.reconnectAttempt++;
    setTimeout(() => {
      if (this.isRunning) this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        try {
          this.ws.send(JSON.stringify({ method: 'ping' }));
        } catch {
          // ignore
        }
      }
    }, 45_000);
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== 1) return;

    for (const coin of this.symbols) {
      // 1. Subscribe to real-time trade prints (with taker side B/A)
      this.ws.send(
        JSON.stringify({
          method: 'subscribe',
          subscription: { type: 'trades', coin },
        }),
      );

      // 2. Subscribe to L2 orderbook
      this.ws.send(
        JSON.stringify({
          method: 'subscribe',
          subscription: { type: 'l2Book', coin, nSigFigs: 5 },
        }),
      );
    }
  }

  private handleMessage(msg: any): void {
    if (!msg || !msg.channel) return;

    if (msg.channel === 'trades') {
      this.processTrades(msg.data);
    } else if (msg.channel === 'l2Book') {
      this.processL2Book(msg.data);
    }
  }

  /**
   * Processes trade prints stream from Hyperliquid matching engine.
   * Side: "B" = Buyer Initiated (Lift Ask), "A" = Seller Initiated (Hit Bid)
   */
  public processTrades(tradesData: any[]): void {
    if (!Array.isArray(tradesData)) return;

    const now = Date.now();
    for (const item of tradesData) {
      const coin = this.normalizeSymbol(item.coin ?? '');
      if (!coin) continue;

      const price = parseFloat(item.px);
      const size = parseFloat(item.sz);
      const isBuyerTaker = item.side === 'B';
      const side: 'BUY' | 'SELL' = isBuyerTaker ? 'BUY' : 'SELL';
      const timestamp = item.time ? Number(item.time) : now;

      const tick: TickPrint = {
        symbol: coin,
        price,
        size,
        side,
        timestamp,
        hash: item.hash,
      };

      this.lastPrices.set(coin, price);

      // Update Cumulative Volume Delta (CVD)
      const currentCvd = this.cvdMap.get(coin) ?? 0;
      const signedVolume = isBuyerTaker ? size : -size;
      const newCvd = currentCvd + signedVolume;
      this.cvdMap.set(coin, newCvd);

      // Maintain rolling trade history
      const list = this.recentTrades.get(coin) ?? [];
      list.push(tick);

      // Purge trades older than rolling window
      const cutoff = now - this.rollingWindowMs;
      while (list.length > 0 && list[0]!.timestamp < cutoff) {
        list.shift();
      }
      this.recentTrades.set(coin, list);

      this.emit('tick', tick);
    }

    // Emit updated snapshot for active coins
    for (const coin of this.symbols) {
      const snapshot = this.calculateSnapshot(coin);
      if (snapshot) {
        this.emit('footprint', snapshot);
      }
    }
  }

  /**
   * Processes top 20 L2 orderbook snapshot.
   */
  public processL2Book(bookData: any): void {
    if (!bookData || !bookData.coin || !bookData.levels) return;

    const coin = this.normalizeSymbol(bookData.coin);
    const rawBids = bookData.levels[0] ?? [];
    const rawAsks = bookData.levels[1] ?? [];

    const bids: OrderBookLevel[] = rawBids.map((b: any) => ({
      price: parseFloat(b.px),
      size: parseFloat(b.sz),
      ordersCount: b.n,
    }));

    const asks: OrderBookLevel[] = rawAsks.map((a: any) => ({
      price: parseFloat(a.px),
      size: parseFloat(a.sz),
      ordersCount: a.n,
    }));

    this.orderBooks.set(coin, { bids, asks });

    const snapshot = this.calculateSnapshot(coin);
    if (snapshot) {
      this.emit('footprint', snapshot);
    }
  }

  /**
   * Calculates real-time Volume-Weighted Average Price (VWAP),
   * VWAP Delta (P_last - VWAP), CVD, and Order Book Imbalance (OBI).
   */
  public calculateSnapshot(coin: string): FootprintSnapshot | null {
    const sym = this.normalizeSymbol(coin);
    const lastPrice = this.lastPrices.get(sym);
    if (lastPrice === undefined) return null;

    const trades = this.recentTrades.get(sym) ?? [];
    const now = Date.now();
    const oneMinCutoff = now - 60_000;

    let sumPv = 0;
    let sumV = 0;
    let delta1m = 0;

    for (const t of trades) {
      sumPv += t.price * t.size;
      sumV += t.size;
      if (t.timestamp >= oneMinCutoff) {
        delta1m += t.side === 'BUY' ? t.size : -t.size;
      }
    }

    const vwap = sumV > 0 ? sumPv / sumV : lastPrice;
    const deltaVwap = lastPrice - vwap;
    const cvd = this.cvdMap.get(sym) ?? 0;

    // Calculate Order Book Imbalance (OBI) at depth K
    const ob = this.orderBooks.get(sym);
    let bidDepth5 = 0;
    let askDepth5 = 0;
    let obi = 0;

    if (ob) {
      const topBids = ob.bids.slice(0, this.obiDepth);
      const topAsks = ob.asks.slice(0, this.obiDepth);

      bidDepth5 = topBids.reduce((acc, b) => acc + b.size, 0);
      askDepth5 = topAsks.reduce((acc, a) => acc + a.size, 0);

      const totalDepth = bidDepth5 + askDepth5;
      if (totalDepth > 0) {
        obi = (bidDepth5 - askDepth5) / totalDepth; // [-1.0, +1.0]
      }
    }

    const isAbsorptionConfirmed = Math.abs(obi) >= 0.25;

    return {
      symbol: sym,
      currentPrice: lastPrice,
      vwap,
      deltaVwap,
      cvd,
      obi,
      delta1m,
      bidDepth5,
      askDepth5,
      isAbsorptionConfirmed,
      timestamp: now,
    };
  }

  public getSnapshot(coin: string): FootprintSnapshot | null {
    return this.calculateSnapshot(coin);
  }

  /**
   * Ground-Truth Sweep Absorption Invariant:
   * Replaces synthetic M1 tick approximations with microsecond order flow absorption.
   *
   * BUY (SSL Sweep):
   * Aggressive market sells poured in during the sweep down-wick, but the top-5 order book
   * shows strong passive bid support (OBI >= +0.25) and VWAP delta or 1-minute CVD is positive.
   *
   * SELL (BSL Sweep):
   * Aggressive market buys poured in during the sweep up-wick, but top-5 order book shows
   * heavy passive ask walls (OBI <= -0.25) and VWAP delta or 1-minute CVD is negative.
   */
  public isSweepAbsorbed(symbol: string, direction: 'BUY' | 'SELL'): boolean {
    const fp = this.getSnapshot(symbol);
    if (!fp) return false;

    if (direction === 'BUY') {
      // Bullish absorption: Strong bid density + positive delta/divergence
      return fp.obi >= 0.25 && (fp.delta1m >= 0 || fp.deltaVwap >= 0);
    } else {
      // Bearish absorption: Strong ask density + negative delta/divergence
      return fp.obi <= -0.25 && (fp.delta1m <= 0 || fp.deltaVwap <= 0);
    }
  }
}
