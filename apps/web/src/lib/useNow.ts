import { useEffect, useState } from "react";

/**
 * The wall clock, ticking slowly. Clocks on screen are times, not
 * countdowns, so nothing here needs to be fast: the tick exists for a day
 * rolling over ("18:12" becoming "tomorrow 18:12" is wrong after midnight)
 * and for a claim window that has quietly expired.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
