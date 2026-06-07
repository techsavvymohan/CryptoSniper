import { PublicKey } from '@solana/web3.js';
export declare const RAYDIUM_CLMM_PROGRAM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
export declare const ORCA_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
export declare const JITO_TIP_ACCOUNTS: readonly string[];
export declare const KNOWN_TOKENS: Readonly<Record<string, PublicKey>>;
export declare const CHANNELS: {
    readonly OPPORTUNITIES: "mev:opportunities";
    readonly POOL_UPDATES: "mev:pools";
    readonly ALERTS: "mev:alerts";
};
export declare const TOKEN_PROGRAM_ID: PublicKey;
export declare const ASSOCIATED_TOKEN_PROGRAM_ID: PublicKey;
