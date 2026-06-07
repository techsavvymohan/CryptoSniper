export declare function selectRandomJitoTipAccount(): string;
export declare function generateId(): string;
export declare function retry<T>(fn: () => Promise<T>, maxAttempts?: number, baseDelayMs?: number): Promise<T>;
export declare function sleep(ms: number): Promise<void>;
