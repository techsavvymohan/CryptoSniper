import { 
  PublicKey, 
  TransactionInstruction, 
  AccountMeta 
} from '@solana/web3.js';

const ORCA_WHIRLPOOL_PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// swap instruction discriminator for Orca Whirlpool
const ORCA_SWAP_DISCRIMINATOR = Buffer.from([0xf8, 0x8f, 0x15, 0xeb, 0x38, 0x2e, 0x4e, 0x90]);

export interface OrcaSwapParams {
  whirlpoolAddress: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tickArrays: [PublicKey, PublicKey, PublicKey];
  oracle: PublicKey;
  /** Total input amount */
  amount: bigint;
  /** Minimum output amount (slippage protection) */
  otherAmountThreshold: bigint;
  sqrtPriceLimit: bigint;
  amountSpecifiedIsInput: boolean;
  aToB: boolean;
}

export class OrcaSwapBuilder {
  /**
   * Builds an Orca Whirlpool swap instruction manually.
   * This avoids importing the heavy Orca Whirlpool SDK.
   */
  buildSwapInstruction(params: OrcaSwapParams, walletPubkey: PublicKey): TransactionInstruction {
    // FIX 5: Oracle account PDA: findProgramAddressSync(['oracle', whirlpoolAddress], ORCA_PROGRAM_ID)
    const [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('oracle'), params.whirlpoolAddress.toBuffer()],
      ORCA_WHIRLPOOL_PROGRAM_ID
    );

    // Build instruction data: 8 (disc) + 8 (amountIn) + 8 (minAmountOut) + 16 (sqrtPriceLimit) + 1 (aToB) + 1 (amountSpecifiedIsInput)
    const data = Buffer.alloc(8 + 8 + 8 + 16 + 1 + 1);
    
    ORCA_SWAP_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(params.amount, 8);
    data.writeBigUInt64LE(params.otherAmountThreshold, 16);

    // sqrtPriceLimit as u128 LE
    data.writeBigUInt64LE(params.sqrtPriceLimit & BigInt('0xFFFFFFFFFFFFFFFF'), 24);
    data.writeBigUInt64LE(params.sqrtPriceLimit >> BigInt(64), 32);

    data[40] = params.aToB ? 1 : 0;
    data[41] = params.amountSpecifiedIsInput ? 1 : 0;

    // FIX 5: Verify account metas order matches Orca IDL exactly
    // FIX 5: Token accounts must be user's ATAs, not pool vaults (opposite of Raydium)
    const keys: AccountMeta[] = [
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: walletPubkey, isSigner: true, isWritable: false },
      { pubkey: params.whirlpoolAddress, isSigner: false, isWritable: true },
      { pubkey: params.tokenOwnerAccountA, isSigner: false, isWritable: true },
      { pubkey: params.tokenVaultA, isSigner: false, isWritable: true },
      { pubkey: params.tokenOwnerAccountB, isSigner: false, isWritable: true },
      { pubkey: params.tokenVaultB, isSigner: false, isWritable: true },
      // FIX 5: Verify 3 tick arrays are in the correct order for swap direction
      { pubkey: params.tickArrays[0], isSigner: false, isWritable: true },
      { pubkey: params.tickArrays[1], isSigner: false, isWritable: true },
      { pubkey: params.tickArrays[2], isSigner: false, isWritable: true },
      { pubkey: oraclePda, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({ 
      programId: ORCA_WHIRLPOOL_PROGRAM_ID, 
      keys, 
      data 
    });
  }

  /**
   * Helper to calculate minimum amount out based on slippage bps.
   */
  calculateMinimumAmountOut(expectedAmountOut: bigint, slippageBps: number): bigint {
    // minimumAmountOut = expectedAmountOut * (10000 - slippageBps) / 10000
    return (expectedAmountOut * BigInt(10000 - slippageBps)) / BigInt(10000);
  }

  /**
   * Calculates the 3 tick array addresses needed for a swap.
   */
  getTickArraysForSwap(
    whirlpoolAddress: PublicKey, 
    currentTick: number, 
    tickSpacing: number, 
    aToB: boolean
  ): PublicKey[] {
    const TICK_ARRAY_SIZE = 88;
    const ticksInArray = tickSpacing * TICK_ARRAY_SIZE;
    
    // Tick array start index calculation
    const startTick = Math.floor(currentTick / ticksInArray) * ticksInArray;
    
    const starts = aToB
      ? [startTick, startTick - ticksInArray, startTick - ticksInArray * 2]
      : [startTick, startTick + ticksInArray, startTick + ticksInArray * 2];

    return starts.map(start => {
      const [pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('tick_array'), 
          whirlpoolAddress.toBuffer(), 
          Buffer.from(start.toString())
        ],
        ORCA_WHIRLPOOL_PROGRAM_ID
      );
      return pda;
    });
  }
}
