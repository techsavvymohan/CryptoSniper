import { Pool as PgPool } from 'pg';
import type { PoolSnapshot } from '@mev-research/shared';

export class PoolRepository {
  constructor(private pool: PgPool) {}

  async insert(snapshot: PoolSnapshot): Promise<void> {
    await this.pool.query(
      `INSERT INTO pool_snapshots
         (address, dex, token_mint_a, token_mint_b, price,
          liquidity_a, liquidity_b, fee_bps, slot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        snapshot.address, snapshot.dex, snapshot.tokenMintA, snapshot.tokenMintB,
        snapshot.price, snapshot.liquidityA, snapshot.liquidityB,
        snapshot.feeBps, snapshot.slot,
      ],
    );
  }

  async getLatest(address: string): Promise<PoolSnapshot | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM pool_snapshots
       WHERE address = $1
       ORDER BY captured_at DESC
       LIMIT 1`,
      [address],
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async getHistory(address: string, limit: number): Promise<PoolSnapshot[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM pool_snapshots
       WHERE address = $1
       ORDER BY captured_at DESC
       LIMIT $2`,
      [address, limit],
    );
    return result.rows.map(r => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): PoolSnapshot {
    return {
      address: row['address'] as string,
      dex: row['dex'] as PoolSnapshot['dex'],
      tokenMintA: row['token_mint_a'] as string,
      tokenMintB: row['token_mint_b'] as string,
      price: Number(row['price']),
      liquidityA: Number(row['liquidity_a']),
      liquidityB: Number(row['liquidity_b']),
      feeBps: Number(row['fee_bps']),
      sqrtPriceX64: BigInt(0),
      slot: Number(row['slot']),
      timestamp: new Date(row['captured_at'] as string).getTime(),
    };
  }
}
