import type { Candle, Timeframe } from '@mev-research/shared';

export interface ResampleResult {
  m1: Candle;
  closedM5?: Candle;
  closedM15?: Candle;
  closedH1?: Candle;
  closedH4?: Candle;
}

export class CausalMultiTFResampler {
  private buffers = new Map<string, Map<Timeframe, Candle[]>>();
  private maxBufferSize: number;

  constructor(maxBufferSize = 500) {
    this.maxBufferSize = maxBufferSize;
  }

  private getBuffer(symbol: string, tf: Timeframe): Candle[] {
    if (!this.buffers.has(symbol)) {
      this.buffers.set(symbol, new Map());
    }
    const symbolMap = this.buffers.get(symbol)!;
    if (!symbolMap.has(tf)) {
      symbolMap.set(tf, []);
    }
    return symbolMap.get(tf)!;
  }

  public pushCandle(symbol: string, tf: Timeframe, candle: Candle): void {
    const buf = this.getBuffer(symbol, tf);
    // Avoid duplicate open_time
    const existingIdx = buf.findIndex(c => c.openTime === candle.openTime);
    if (existingIdx >= 0) {
      buf[existingIdx] = candle;
    } else {
      buf.push(candle);
      if (buf.length > this.maxBufferSize) {
        buf.shift();
      }
    }
  }

  public getCandles(symbol: string, tf: Timeframe, count?: number): Candle[] {
    const buf = this.getBuffer(symbol, tf);
    if (count === undefined || count >= buf.length) {
      return [...buf];
    }
    return buf.slice(-count);
  }

  public getLatestCandle(symbol: string, tf: Timeframe): Candle | undefined {
    const buf = this.getBuffer(symbol, tf);
    return buf.length > 0 ? buf[buf.length - 1] : undefined;
  }

  /**
   * Ingest a completed (isClosed = true) M1 candle and causally synthesize
   * higher-timeframe candles (M5, M15, H1, H4) without future look-ahead.
   */
  public addM1Candle(candle: Candle): ResampleResult {
    const symbol = candle.symbol;
    this.pushCandle(symbol, 'M1', candle);

    const m1Buffer = this.getBuffer(symbol, 'M1');
    const result: ResampleResult = { m1: candle };

    // Causal M5: 5 M1 bars ending on a 5-minute boundary
    // 5 minutes = 300,000 ms
    if (candle.closeTime % 300_000 === 0 || (candle.openTime + 60_000) % 300_000 === 0) {
      const m5 = this.aggregateBars(m1Buffer, 5, 'M5');
      if (m5) {
        this.pushCandle(symbol, 'M5', m5);
        result.closedM5 = m5;
      }
    }

    // Causal M15: 15 M1 bars ending on a 15-minute boundary
    // 15 minutes = 900,000 ms
    if (candle.closeTime % 900_000 === 0 || (candle.openTime + 60_000) % 900_000 === 0) {
      const m15 = this.aggregateBars(m1Buffer, 15, 'M15');
      if (m15) {
        this.pushCandle(symbol, 'M15', m15);
        result.closedM15 = m15;
      }
    }

    // Causal H1: 60 M1 bars ending on a 1-hour boundary
    // 1 hour = 3,600,000 ms
    if (candle.closeTime % 3_600_000 === 0 || (candle.openTime + 60_000) % 3_600_000 === 0) {
      const h1 = this.aggregateBars(m1Buffer, 60, 'H1');
      if (h1) {
        this.pushCandle(symbol, 'H1', h1);
        result.closedH1 = h1;
      }
    }

    // Causal H4: 240 M1 bars ending on a 4-hour boundary
    // 4 hours = 14,400,000 ms
    if (candle.closeTime % 14_400_000 === 0 || (candle.openTime + 60_000) % 14_400_000 === 0) {
      const h4 = this.aggregateBars(m1Buffer, 240, 'H4');
      if (h4) {
        this.pushCandle(symbol, 'H4', h4);
        result.closedH4 = h4;
      }
    }

    return result;
  }

  private aggregateBars(sourceBars: Candle[], count: number, targetTf: Timeframe): Candle | null {
    if (sourceBars.length < count) return null;

    const slice = sourceBars.slice(-count);
    const first = slice[0]!;
    const last = slice[slice.length - 1]!;

    let high = -Infinity;
    let low = Infinity;
    let volume = 0;

    for (const b of slice) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += b.volume;
    }

    return {
      symbol: first.symbol,
      timeframe: targetTf,
      openTime: first.openTime,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      closeTime: last.closeTime,
      isClosed: true,
    };
  }
}
