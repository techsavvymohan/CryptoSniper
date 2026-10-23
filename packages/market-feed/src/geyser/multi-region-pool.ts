import { EventEmitter } from 'events';
import { YellowstoneClient, AccountUpdate } from '../grpc/yellowstone-client.js';
import { GeyserDeduplicator } from './deduplicator.js';

export interface GeyserRegionConfig {
  id: string;
  name: string;
  endpoint: string;
  token?: string;
}

export interface RegionalTelemetry {
  regionId: string;
  name: string;
  endpoint: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' | 'ERROR';
  raceWins: number;
  winRatePct: number;
  duplicatesDropped: number;
  lastSeenSlot: number;
  lastSeenTimestamp: number;
}

export interface MultiRegionPoolConfig {
  regions?: GeyserRegionConfig[];
  defaultToken?: string;
  deduplicator?: GeyserDeduplicator;
}

export class MultiRegionYellowstonePool extends EventEmitter {
  private clients = new Map<string, YellowstoneClient>();
  private regionConfigs: GeyserRegionConfig[];
  private deduplicator: GeyserDeduplicator;
  private defaultToken: string;
  private isRunning = false;

  private stats = new Map<
    string,
    {
      status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' | 'ERROR';
      raceWins: number;
      duplicatesDropped: number;
      lastSeenSlot: number;
      lastSeenTimestamp: number;
    }
  >();

  constructor(config: MultiRegionPoolConfig = {}) {
    super();
    this.defaultToken = config.defaultToken ?? '';
    this.deduplicator = config.deduplicator ?? new GeyserDeduplicator(50_000);

    this.regionConfigs = config.regions && config.regions.length > 0
      ? config.regions
      : [
          {
            id: 'AMS',
            name: 'Amsterdam (Europe Validator Cluster)',
            endpoint: process.env['HELIUS_GRPC_AMS'] ?? 'amsterdam.helius-rpc.com:443',
          },
          {
            id: 'TYO',
            name: 'Tokyo (Asia Validator Cluster)',
            endpoint: process.env['HELIUS_GRPC_TYO'] ?? 'tokyo.helius-rpc.com:443',
          },
          {
            id: 'EWR',
            name: 'New York (US East Hub)',
            endpoint: process.env['HELIUS_GRPC_EWR'] ?? 'mainnet.helius-rpc.com:443',
          },
        ];

    for (const r of this.regionConfigs) {
      this.stats.set(r.id, {
        status: 'DISCONNECTED',
        raceWins: 0,
        duplicatesDropped: 0,
        lastSeenSlot: 0,
        lastSeenTimestamp: 0,
      });
    }
  }

  public async start(watchedAccounts: string[]): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    for (const reg of this.regionConfigs) {
      const token = reg.token ?? this.defaultToken;
      const client = new YellowstoneClient(reg.endpoint, token);

      client.on('connected', () => {
        const s = this.stats.get(reg.id);
        if (s) s.status = 'CONNECTED';
        this.emit('regionConnected', { region: reg.id });
      });

      client.on('disconnected', () => {
        const s = this.stats.get(reg.id);
        if (s) s.status = 'DISCONNECTED';
        this.emit('regionDisconnected', { region: reg.id });
      });

      client.on('error', (err) => {
        const s = this.stats.get(reg.id);
        if (s) s.status = 'ERROR';
        this.emit('regionError', { region: reg.id, error: err });
      });

      client.on('accountUpdate', (update: AccountUpdate) => {
        this.handleRegionalUpdate(reg.id, update);
      });

      this.clients.set(reg.id, client);
      client.start(watchedAccounts).catch(err => {
        this.emit('regionError', { region: reg.id, error: err });
      });
    }

    console.log(
      `[GeyserPool] Multi-Region Yellowstone Pool started across ${this.regionConfigs.length} regions: [${this.regionConfigs.map(r => r.id).join(', ')}]`,
    );
  }

  public stop(): void {
    this.isRunning = false;
    for (const client of this.clients.values()) {
      try {
        client.stop();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
  }

  private handleRegionalUpdate(regionId: string, update: AccountUpdate): void {
    const now = Date.now();
    const regStat = this.stats.get(regionId);
    if (regStat) {
      regStat.lastSeenSlot = update.slot;
      regStat.lastSeenTimestamp = now;
    }

    // Atomic race-first deduplication check
    const shouldProcess = this.deduplicator.shouldProcess(
      update.pubkey,
      update.writeVersion,
      update.slot,
    );

    if (!shouldProcess) {
      // Duplicate arrived from slower regional route: drop instantly
      if (regStat) regStat.duplicatesDropped++;
      return;
    }

    // Faster regional stream won the latency race!
    if (regStat) regStat.raceWins++;

    update.region = regionId;
    update.receivedAt = now;

    this.emit('accountUpdate', update);
    this.emit('raceWinner', {
      region: regionId,
      pubkey: update.pubkey,
      slot: update.slot,
    });
  }

  public getTelemetry(): RegionalTelemetry[] {
    const totalWins = Array.from(this.stats.values()).reduce((sum, s) => sum + s.raceWins, 0);

    return this.regionConfigs.map(reg => {
      const s = this.stats.get(reg.id) ?? {
        status: 'DISCONNECTED',
        raceWins: 0,
        duplicatesDropped: 0,
        lastSeenSlot: 0,
        lastSeenTimestamp: 0,
      };

      const winRatePct = totalWins > 0 ? (s.raceWins / totalWins) * 100 : 0;

      return {
        regionId: reg.id,
        name: reg.name,
        endpoint: reg.endpoint,
        status: s.status,
        raceWins: s.raceWins,
        winRatePct,
        duplicatesDropped: s.duplicatesDropped,
        lastSeenSlot: s.lastSeenSlot,
        lastSeenTimestamp: s.lastSeenTimestamp,
      };
    });
  }

  public getDeduplicatorStats() {
    return this.deduplicator.getStats();
  }
}
