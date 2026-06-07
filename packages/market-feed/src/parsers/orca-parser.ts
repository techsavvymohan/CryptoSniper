import type { PoolSnapshot } from '@mev-research/shared';

// Minimum account data length for an Orca Whirlpool account
const MIN_ACCOUNT_DATA_LENGTH = 300;

/**
 * Byte offsets within an Orca Whirlpool account (after 8-byte discriminator).
 * Derived from the Whirlpool on-chain layout v0.2.
 *
 * Offset 8:   whirlpoolsConfig  (32 bytes, PublicKey)
 * Offset 40:  whirlpoolBump     (1 byte)
 * Offset 41:  tickSpacing       (2 bytes, u16 LE)
 * Offset 43:  tickSpacingSeed   (2 bytes)
 * Offset 45:  feeRate           (2 bytes, u16 LE)  ← bps * 100 (e.g. 3000 = 30 bps)
 * Offset 47:  protocolFeeRate   (2 bytes, u16 LE)
 * Offset 49:  liquidity         (16 bytes, u128 LE)
 * Offset 65:  sqrtPrice         (16 bytes, u128 LE)
 * Offset 81:  tickCurrentIndex  (4 bytes,  i32 LE)
 * Offset 101: tokenMintA        (32 bytes, PublicKey)
 * Offset 133: tokenVaultA       (32 bytes, PublicKey)
 * Offset 165: tokenMintB        (32 bytes, PublicKey)
 * Offset 197: tokenVaultB       (32 bytes, PublicKey)
 */
const SQRT_PRICE_OFFSET = 65;
const FEE_RATE_OFFSET = 45;
const TOKEN_MINT_A_OFFSET = 101;
const TOKEN_MINT_B_OFFSET = 165;

export function parseOrcaWhirlpool(
  address: string,
  data: Buffer,
  slot: number,
): PoolSnapshot | null {
  try {
    if (data.length < MIN_ACCOUNT_DATA_LENGTH) return null;

    // Read sqrtPrice as u128 little-endian (16 bytes) at offset 65
    const sqrtLow = data.readBigUInt64LE(SQRT_PRICE_OFFSET);
    const sqrtHigh = data.readBigUInt64LE(SQRT_PRICE_OFFSET + 8);
    const sqrtPriceX64 = sqrtLow | (sqrtHigh << BigInt(64));

    if (sqrtPriceX64 === BigInt(0)) return null;

    // Convert: price = (sqrtPriceX64 / 2^64)^2 — same formula as Raydium
    const price = (Number(sqrtPriceX64) / 2 ** 64) ** 2;

    // FeeRate from bytes 45-46 as u16. Orca stores it in hundredths of bps (e.g., 3000 = 30bps)
    const feeRateRaw = data.readUInt16LE(FEE_RATE_OFFSET);
    const feeBps = feeRateRaw / 100;

    const tokenMintA = encodeBase58(data.slice(TOKEN_MINT_A_OFFSET, TOKEN_MINT_A_OFFSET + 32));
    const tokenMintB = encodeBase58(data.slice(TOKEN_MINT_B_OFFSET, TOKEN_MINT_B_OFFSET + 32));

    return {
      address,
      dex: 'orca',
      tokenMintA,
      tokenMintB,
      price,
      sqrtPriceX64,
      liquidityA: 0,
      liquidityB: 0,
      feeBps,
      slot,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

function encodeBase58(bytes: Buffer): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) result += '1';
  for (let i = digits.length - 1; i >= 0; i--) result += ALPHABET[digits[i]!];
  return result;
}
