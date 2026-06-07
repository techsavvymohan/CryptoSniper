import { 
  PublicKey, 
  TransactionInstruction, 
  AccountMeta 
} from '@solana/web3.js';

const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// swap instruction discriminator (first 8 bytes of sha256("global:swap"))
const SWAP_DISCRIMINATOR = Buffer.from([0xf8, 0xc6, 0x9e, 0x91, 0xe1, 0x75, 0x87, 0xc8]);

export interface RaydiumSwapParams {
  poolAddress: PublicKey;
  inputTokenMint: PublicKey;
  outputTokenMint: PublicKey;
  inputTokenAccount: PublicKey;   // user's input token ATA
  outputTokenAccount: PublicKey;  // user's output token ATA
  inputVault: PublicKey;          // pool's input vault
  outputVault: PublicKey;         // pool's output vault
  amountIn: bigint;               // in smallest units (lamports or token decimals)
  minimumAmountOut: bigint;       // slippage protection: amountOut * (1 - slippageTolerance)
  sqrtPriceLimitX64: bigint;      // 0 for no limit
  observationId: PublicKey;       // pool observation account
  ammConfig: PublicKey;           // pool config account
}

export class RaydiumSwapBuilder {
  /**
   * Builds a Raydium CLMM swap instruction manually.
   * This avoids importing the heavy Raydium SDK.
   */
  buildSwapInstruction(params: RaydiumSwapParams, walletPubkey: PublicKey): TransactionInstruction {
    // FIX 4: amountIn and minimumAmountOut must be in token smallest units (already bigint)
    // FIX 4: sqrtPriceLimitX64 = BigInt(0) disables price limit — use this for testing/default
    const sqrtPriceLimit = params.sqrtPriceLimitX64 || BigInt(0);

    // Build instruction data buffer: 8 (disc) + 8 (amountIn) + 8 (minAmountOut) + 16 (sqrtPriceLimit) + 1 (isBaseInput)
    const data = Buffer.alloc(8 + 8 + 8 + 16 + 1);
    
    // FIX 4: Verify instruction discriminator bytes are correct for 'swap' function
    SWAP_DISCRIMINATOR.copy(data, 0);
    
    data.writeBigUInt64LE(params.amountIn, 8);
    data.writeBigUInt64LE(params.minimumAmountOut, 16);
    
    // sqrtPriceLimit as u128
    data.writeBigUInt64LE(sqrtPriceLimit & BigInt('0xFFFFFFFFFFFFFFFF'), 24);
    data.writeBigUInt64LE(sqrtPriceLimit >> BigInt(64), 32);
    
    data[40] = 1; // isBaseInput: true

    // FIX 4: Verify account metas are in the EXACT order the CLMM program expects
    const keys: AccountMeta[] = [
      { pubkey: walletPubkey, isSigner: true, isWritable: true },
      { pubkey: params.ammConfig, isSigner: false, isWritable: false },
      { pubkey: params.poolAddress, isSigner: false, isWritable: true },
      { pubkey: params.inputTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.outputTokenAccount, isSigner: false, isWritable: true },
      // FIX 4: Verify all vault addresses are the POOL'S vaults, not user's token accounts
      { pubkey: params.inputVault, isSigner: false, isWritable: true },
      { pubkey: params.outputVault, isSigner: false, isWritable: true },
      { pubkey: params.observationId, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: params.inputTokenMint, isSigner: false, isWritable: false },
      { pubkey: params.outputTokenMint, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({ 
      programId: RAYDIUM_CLMM_PROGRAM_ID, 
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
}
