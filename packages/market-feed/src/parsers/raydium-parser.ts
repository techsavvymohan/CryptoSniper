import type { PoolSnapshot } from '@mev-research/shared';
import { RAYDIUM_CLMM_PROGRAM } from '@mev-research/shared';

// Minimum account data length for a Raydium CLMM pool account
const MIN_ACCOUNT_DATA_LENGTH = 400;

/**
 * Byte offsets within a Raydium CLMM PoolState account (after 8-byte discriminator).
 * Derived from the on-chain layout in raydium-clmm program v2.
 *
 * Offset 8:   ammConfig        (32 bytes, PublicKey)
 * Offset 40:  owner            (32 bytes, PublicKey)
 * Offset 72:  tokenMint0       (32 bytes, PublicKey)
 * Offset 104: tokenMint1       (32 bytes, PublicKey)
 * Offset 136: tokenVault0      (32 bytes, PublicKey)
 * Offset 168: tokenVault1      (32 bytes, PublicKey)
 * Offset 200: observationKey   (32 bytes, PublicKey)
 * Offset 232: mintDecimals0    (1 byte,  u8)
 * Offset 233: mintDecimals1    (1 byte,  u8)
 * Offset 234: tickSpacing      (2 bytes, u16 LE)
 * Offset 236: liquidity        (16 bytes, u128 LE)
 * Offset 252: sqrtPriceX64    (16 bytes, u128 LE)
 * Offset 268: tickCurrent      (4 bytes,  i32 LE)
 * Offset 300: feeGrowthGlobalX64_0 (16 bytes)
 * Offset 316: feeGrowthGlobalX64_1 (16 bytes)
 * Offset 332: protocolFeesToken0   (8 bytes)
 * Offset 340: protocolFeesToken1   (8 bytes)
 * Offset 348: swapInAmountToken0   (16 bytes)
 * Offset 364: swapOutAmountToken1  (16 bytes)
 */
const SQRT_PRICE_OFFSET = 252;
const TOKEN_MINT_0_OFFSET = 72;
const TOKEN_MINT_1_OFFSET = 104;
const TOKEN_VAULT_0_OFFSET = 136;

// Standard Raydium CLMM fee = 30 bps (conservative)
const RAYDIUM_FEE_BPS = 30;

export function parseRaydiumClmmPool(
  address: string,
  data: Buffer,
  slot: number,
): PoolSnapshot | null {
  try {
    if (data.length < MIN_ACCOUNT_DATA_LENGTH) return null;

    // Read sqrtPriceX64 as u128 little-endian (16 bytes)
    const sqrtLow = data.readBigUInt64LE(SQRT_PRICE_OFFSET);
    const sqrtHigh = data.readBigUInt64LE(SQRT_PRICE_OFFSET + 8);
    const sqrtPriceX64 = sqrtLow | (sqrtHigh << BigInt(64));

    if (sqrtPriceX64 === BigInt(0)) return null;

    // Convert: price = (sqrtPriceX64 / 2^64)^2
    const price = (Number(sqrtPriceX64) / 2 ** 64) ** 2;

    // Read token mints (32-byte public keys as base58)
    const tokenMintA = encodeBase58(data.slice(TOKEN_MINT_0_OFFSET, TOKEN_MINT_0_OFFSET + 32));
    const tokenMintB = encodeBase58(data.slice(TOKEN_MINT_1_OFFSET, TOKEN_MINT_1_OFFSET + 32));

    // Rough liquidity estimate from vault 0 (placeholder — real apps read vault account separately)
    // We use token vault 0 offset for parsing pool identity; liquidity is set to 0 here
    void TOKEN_VAULT_0_OFFSET;

    return {
      address,
      dex: 'raydium',
      tokenMintA,
      tokenMintB,
      price,
      sqrtPriceX64,
      liquidityA: 0,
      liquidityB: 0,
      feeBps: RAYDIUM_FEE_BPS,
      slot,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

function encodeBase58(bytes: Buffer): string {
  // Inline Base58 encoder for Solana public keys
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
