"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSOCIATED_TOKEN_PROGRAM_ID = exports.TOKEN_PROGRAM_ID = exports.CHANNELS = exports.KNOWN_TOKENS = exports.JITO_TIP_ACCOUNTS = exports.ORCA_WHIRLPOOL_PROGRAM = exports.RAYDIUM_CLMM_PROGRAM = void 0;
const web3_js_1 = require("@solana/web3.js");
exports.RAYDIUM_CLMM_PROGRAM = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
exports.ORCA_WHIRLPOOL_PROGRAM = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
exports.JITO_TIP_ACCOUNTS = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhVRvQT',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'Cw8CFFL1KWXYR4YfW969SYfK7WNoSPAkGr7ixSXvJa46',
    'ADaUMid9yfUytqMBsboS1S9PK92shAyE99N95XUnfB2a',
    'ADuB1n3U4PEC2Kxa5otF8S28YQsMAnY77SNoZ8HVsE9f',
    'DfXygSm4jCyNCmbm7Y9HAdC7wCx4P5rZ8P8u679bJ8Yj',
    'DttWaMuVvTf86A89VatS4ko7S6n8B6mNWhLxr9pS1E8n',
    '3AVi9Tg9Uo68ayJ9K9Sno9p1nzR8qB9vX6F48f76YJ9e',
];
exports.KNOWN_TOKENS = {
    SOL: new web3_js_1.PublicKey('So11111111111111111111111111111111111111112'),
    WSOL: new web3_js_1.PublicKey('So11111111111111111111111111111111111111112'),
    USDC: new web3_js_1.PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    BONK: new web3_js_1.PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'),
    JUP: new web3_js_1.PublicKey('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'),
    RAY: new web3_js_1.PublicKey('4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'),
};
exports.CHANNELS = {
    OPPORTUNITIES: 'mev:opportunities',
    POOL_UPDATES: 'mev:pools',
    ALERTS: 'mev:alerts',
};
exports.TOKEN_PROGRAM_ID = new web3_js_1.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
exports.ASSOCIATED_TOKEN_PROGRAM_ID = new web3_js_1.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bv');
