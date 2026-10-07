/**
 * Date and time formatting utilities for Upaznet Helpdesk.
 * Complies with docs/DESIGN_SYSTEM.md v2.0 §14:
 * - Absolute format: "19 Sep 2026, 09.41 WIB"
 * - Relative format: "2 menit lalu", "baru saja" with absolute fallback
 */

const INDONESIAN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
] as const;

function getWibParts(date: Date): { day: number; month: number; year: number; hours: string; minutes: string } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  let day = 1;
  let month = 1;
  let year = 1970;
  let hours = "00";
  let minutes = "00";

  for (const p of parts) {
    if (p.type === "day") day = parseInt(p.value, 10);
    else if (p.type === "month") month = parseInt(p.value, 10);
    else if (p.type === "year") year = parseInt(p.value, 10);
    else if (p.type === "hour") {
      let h = parseInt(p.value, 10);
      if (h === 24) h = 0;
      hours = String(h).padStart(2, "0");
    } else if (p.type === "minute") {
      minutes = p.value.padStart(2, "0");
    }
  }

  return { day, month, year, hours, minutes };
}

/**
 * Formats an ISO date string into absolute Indonesian time: "19 Sep 2026, 09.41 WIB".
 * Guarantees Asia/Jakarta (WIB) regardless of local machine/process timezone.
 */
export function formatAbsoluteDate(isoString: string): string {
  if (!isoString) return "-";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const { day, month, year, hours, minutes } = getWibParts(date);
  const monthName = INDONESIAN_MONTHS[month - 1] ?? "";

  return `${day} ${monthName} ${year}, ${hours}.${minutes} WIB`;
}

/**
 * Formats an ISO date string into time-only Indonesian format: "09.41 WIB".
 * Guarantees Asia/Jakarta (WIB) regardless of local machine/process timezone.
 */
export function formatTimeOnly(isoString: string): string {
  if (!isoString) return "-";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const { hours, minutes } = getWibParts(date);

  return `${hours}.${minutes} WIB`;
}

/**
 * Formats an ISO date string into relative time (e.g. "2 menit lalu", "baru saja").
 */
export function formatRelativeTime(isoString: string, now: Date = new Date()): string {
  if (!isoString) return "-";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return isoString;

  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) {
    return formatAbsoluteDate(isoString);
  }

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 15) {
    return "baru saja";
  }
  if (diffSec < 60) {
    return `${diffSec} dtk lalu`;
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin} mnt lalu`;
  }

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour} jam lalu`;
  }

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) {
    return "kemarin";
  }
  if (diffDay < 7) {
    return `${diffDay} hr lalu`;
  }

  return formatAbsoluteDate(isoString);
}
