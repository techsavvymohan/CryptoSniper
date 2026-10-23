export interface SessionInfo {
  sessionName: string;
  isHighVolumeWindow: boolean;
  isWeekend: boolean;
  utcHour: number;
  utcMinute: number;
}

/**
 * Returns current crypto session details based on UTC timestamp.
 */
export function getCurrentSession(timestamp = Date.now()): SessionInfo {
  const d = new Date(timestamp);
  const day = d.getUTCDay(); // 0 = Sun, 6 = Sat
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();

  const isWeekend = day === 0 || day === 6;

  let sessionName = 'OFF_SESSION';
  let isHighVolumeWindow = false;

  // US ETF & Cash Open (13:30 - 17:00 UTC) -> Highest institutional volume
  if (hour === 13 && minute >= 30) {
    sessionName = 'US_ETF_OPEN';
    isHighVolumeWindow = true;
  } else if (hour >= 14 && hour < 17) {
    sessionName = 'US_ETF_CORE';
    isHighVolumeWindow = true;
  }
  // London Session (07:00 - 10:00 UTC)
  else if (hour >= 7 && hour < 10) {
    sessionName = 'LONDON_INGESTION';
    isHighVolumeWindow = true;
  }
  // Asia Open (00:00 - 03:00 UTC)
  else if (hour >= 0 && hour < 3) {
    sessionName = 'ASIA_OPEN';
    isHighVolumeWindow = false;
  }

  return {
    sessionName,
    isHighVolumeWindow,
    isWeekend,
    utcHour: hour,
    utcMinute: minute,
  };
}

/**
 * Checks whether the timestamp is within bufferMinutes of 8-hour perpetual funding resets
 * (00:00, 08:00, 16:00 UTC).
 */
export function isNearFundingReset(timestamp = Date.now(), bufferMinutes = 10): boolean {
  const d = new Date(timestamp);
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();

  // Reset hours are 0, 8, 16
  const resetHours = [0, 8, 16];

  for (const rHour of resetHours) {
    // Check right before funding (e.g. 23:50-23:59 for 00:00)
    const prevHour = (rHour - 1 + 24) % 24;
    if (hour === prevHour && minute >= 60 - bufferMinutes) {
      return true;
    }
    // Check right after funding (e.g. 00:00-00:05)
    if (hour === rHour && minute <= bufferMinutes) {
      return true;
    }
  }

  return false;
}
