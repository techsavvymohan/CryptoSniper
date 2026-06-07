import { EventEmitter } from 'events';
import Client, { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';
import type { ClientDuplexStream } from '@grpc/grpc-js';
import type { SubscribeUpdate } from '@triton-one/yellowstone-grpc';

export interface AccountUpdate {
  pubkey: string;
  data: Buffer;
  slot: number;
}

export declare interface YellowstoneClient {
  on(event: 'accountUpdate', listener: (update: AccountUpdate) => void): this;
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export class YellowstoneClient extends EventEmitter {
  private client: Client;
  private stream?: ClientDuplexStream<SubscribeRequest, SubscribeUpdate>;
  private subscribeRequest?: SubscribeRequest;
  private reconnectAttempt = 0;
  private stopped = false;

  constructor(
    endpoint: string,
    authToken: string,
  ) {
    super();
    // Yellowstone Client expects a full URL (https://host:port)
    const grpcUrl = endpoint.startsWith('http')
      ? endpoint
      : `https://${endpoint.replace(/^https?:\/\//, '')}`;
    this.client = new Client(grpcUrl, authToken, undefined);
  }

  async start(accounts: string[]): Promise<void> {
    this.stopped = false;
    this.subscribeRequest = {
      accounts: {
        pools: {
          account: accounts,
          owner: [],
          filters: [],
        },
      },
      slots: {},
      transactions: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED,
      entry: {},
      transactionsStatus: {},
    };
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.stream?.cancel?.();
    this.stream = undefined;
  }

  private async connect(): Promise<void> {
    try {
      // subscribe() returns a Promise<ClientDuplexStream>
      this.stream = await this.client.subscribe();
      this.reconnectAttempt = 0;
      this.emit('connected');

      this.stream.on('data', (data: SubscribeUpdate) => {
        try {
          this.handleUpdate(data);
        } catch {
          // Never crash on malformed account data
        }
      });

      this.stream.on('error', (err: Error) => {
        this.emit('error', err);
        this.scheduleReconnect();
      });

      this.stream.on('end', () => {
        this.emit('disconnected');
        this.scheduleReconnect();
      });

      if (this.subscribeRequest) {
        await new Promise<void>((resolve, reject) => {
          this.stream!.write(this.subscribeRequest!, (err: unknown) => {
            if (err) reject(err as Error);
            else resolve();
          });
        });
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    // Exponential backoff: min(500ms * 2^attempt, 30000ms)
    const delay = Math.min(500 * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt++;
    setTimeout(() => {
      if (!this.stopped) {
        this.connect().catch(() => { /* errors handled inside connect */ });
      }
    }, delay);
  }

  private handleUpdate(data: SubscribeUpdate): void {
    const accountInfo = (data as unknown as Record<string, unknown>)['account'] as Record<string, unknown> | undefined;
    if (!accountInfo) return;

    const account = accountInfo['account'] as Record<string, unknown> | undefined;
    if (!account) return;

    const pubkey = accountInfo['pubkey'];
    const rawData = account['data'];
    const slot = (data as unknown as Record<string, unknown>)['slot'] ?? 0;

    if (!pubkey || !rawData) return;

    const dataBuffer = Array.isArray(rawData)
      ? Buffer.from(rawData as number[])
      : rawData instanceof Uint8Array
        ? Buffer.from(rawData)
        : Buffer.alloc(0);

    const pubkeyStr = Buffer.isBuffer(pubkey)
      ? encodeBase58(pubkey as Buffer)
      : String(pubkey);

    this.emit('accountUpdate', {
      pubkey: pubkeyStr,
      data: dataBuffer,
      slot: Number(slot),
    } satisfies AccountUpdate);
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
