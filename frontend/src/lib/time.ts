/**
 * Hand-rolled relative-time formatter.
 *
 * Deliberately small — no date-fns / dayjs dependency. The spec asks
 * only for "X min ago" / "X hours ago" granularity (section 3.1,
 * 3.2 caption text). Anything older than a day falls through to a
 * short date so we don't pretend the user is looking at something
 * they entered "0 days ago".
 *
 * Returns the empty string for unparseable input rather than throwing,
 * so the UI can render the caption unconditionally.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  // Future timestamps (clock skew, manual edit) — treat as "just now"
  // rather than showing a negative duration.
  if (diff < 0) return "just now";

  if (diff < 45_000) return "just now";
  if (diff < HOUR) {
    const m = Math.round(diff / MIN);
    return `${m} min ago`;
  }
  if (diff < DAY) {
    const h = Math.round(diff / HOUR);
    return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  }
  // Beyond a day, show a short date — short enough to fit the caption
  // without wrapping on phone widths.
  const d = new Date(t);
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear ? `${month} ${day}` : `${month} ${day}, ${d.getFullYear()}`;
}

/** Format a number as Bangladeshi Taka. e.g. 12450 → "৳12,450.00" */
export function formatBDT(n: number): string {
  if (!Number.isFinite(n)) return "৳0.00";
  const fixed = n.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `৳${withCommas}.${decPart}`;
}

/**
 * Format an ISO date string (YYYY-MM-DD) to a short label like "Jan 5".
 * Returns the raw string if parsing fails.
 */
export function formatDayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}