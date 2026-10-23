export interface DeduplicatorStats {
  totalEvents: number;
  uniqueEvents: number;
  duplicateEvents: number;
  duplicateDropRatio: number;
  cachedKeysCount: number;
}

interface SeenEntry {
  writeVersion: number;
  slot: number;
  timestamp: number;
}

export class GeyserDeduplicator {
  private seenUpdates = new Map<string, SeenEntry>();
  private readonly maxEntries: number;

  private totalEvents = 0;
  private uniqueEvents = 0;
  private duplicateEvents = 0;

  constructor(maxEntries = 50_000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Fast atomic check on incoming account write.
   * Returns true if this update is novel and should be processed by the bot.
   * Returns false if this write has already been delivered by a faster regional node.
   * Execution budget: < 1 microsecond.
   */
  public shouldProcess(
    pubkey: string,
    writeVersion: bigint | number | undefined,
    slot: number,
  ): boolean {
    this.totalEvents++;

    const versionNum = writeVersion !== undefined ? Number(writeVersion) : undefined;
    const existing = this.seenUpdates.get(pubkey);

    if (existing !== undefined) {
      if (versionNum !== undefined && versionNum > 0) {
        if (versionNum <= existing.writeVersion) {
          this.duplicateEvents++;
          return false;
        }
      } else if (slot <= existing.slot) {
        this.duplicateEvents++;
        return false;
      }
    }

    // Novel update: update LRU ring buffer
    this.uniqueEvents++;
    this.seenUpdates.set(pubkey, {
      writeVersion: versionNum ?? 0,
      slot,
      timestamp: Date.now(),
    });

    // Ring buffer size eviction
    if (this.seenUpdates.size > this.maxEntries) {
      const oldestKey = this.seenUpdates.keys().next().value;
      if (oldestKey) this.seenUpdates.delete(oldestKey);
    }

    return true;
  }

  public getStats(): DeduplicatorStats {
    const ratio = this.totalEvents > 0 ? this.duplicateEvents / this.totalEvents : 0;
    return {
      totalEvents: this.totalEvents,
      uniqueEvents: this.uniqueEvents,
      duplicateEvents: this.duplicateEvents,
      duplicateDropRatio: ratio,
      cachedKeysCount: this.seenUpdates.size,
    };
  }

  public resetStats(): void {
    this.totalEvents = 0;
    this.uniqueEvents = 0;
    this.duplicateEvents = 0;
  }

  public clear(): void {
    this.seenUpdates.clear();
    this.resetStats();
  }
}
