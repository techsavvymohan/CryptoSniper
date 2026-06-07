import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { KNOWN_TOKENS, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, WalletState } from '@mev-research/shared';

export type { WalletState };

export class WalletManager {
  private keypair: Keypair;
  private connection: Connection;
  private walletState: WalletState = { solBalance: 0, usdcBalance: 0 };

  constructor(rpcUrl: string) {
    const privateKey = process.env['BOT_WALLET_PRIVATE_KEY'];
    if (!privateKey) {
      throw new Error('Missing required environment variable: BOT_WALLET_PRIVATE_KEY');
    }
    this.keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    this.connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: false,
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.refreshBalances();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[Wallet] Balance fetch failed (check HELIUS_API_KEY):', message);
      this.walletState = { solBalance: 0, usdcBalance: 0 };
    }
    console.log('[Wallet] Address:', this.keypair.publicKey.toBase58());
    console.log('[Wallet] SOL:', this.walletState.solBalance);
    console.log('[Wallet] USDC:', this.walletState.usdcBalance);
  }

  async refreshBalances(): Promise<WalletState> {
    const solBalance = await this.connection.getBalance(this.keypair.publicKey);

    const usdcTokenAccount = this.findAssociatedTokenAddress(
      this.keypair.publicKey,
      KNOWN_TOKENS['USDC']!,
    );

    let usdcBalance = 0;
    try {
      const response = await this.connection.getTokenAccountBalance(usdcTokenAccount);
      usdcBalance = response.value.uiAmount ?? 0;
    } catch {
      usdcBalance = 0;
    }

    this.walletState = {
      solBalance: solBalance / 1e9,
      usdcBalance,
    };
    return this.walletState;
  }

  getPublicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  getKeypair(): Keypair {
    return this.keypair;
  }

  getCurrentState(): WalletState {
    return this.walletState;
  }

  async hasSufficientBalance(requiredUsdc: number, requiredSolForFees: number): Promise<boolean> {
    await this.refreshBalances();
    return (
      this.walletState.usdcBalance >= requiredUsdc &&
      this.walletState.solBalance >= requiredSolForFees
    );
  }

  findAssociatedTokenAddress(wallet: PublicKey, tokenMint: PublicKey): PublicKey {
    const [address] = PublicKey.findProgramAddressSync(
      [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), tokenMint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    return address;
  }
}
