declare module 'jito-ts/dist/sdk/block-engine/searcher' {
  import { Keypair } from '@solana/web3.js';
  export interface SearcherClient {
    sendBundle(bundle: unknown): Promise<string>;
    onBundleResult(success: (result: unknown) => void, error: (e: Error) => void): () => void;
  }
  export function searcherClient(url: string, keypair: Keypair): SearcherClient;
}

declare module 'jito-ts/dist/sdk/block-engine/types' {
  import { VersionedTransaction } from '@solana/web3.js';
  export class Bundle {
    constructor(txs: VersionedTransaction[], transactionLimit: number);
  }
}
