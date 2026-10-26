import type { AvailabilityRules } from "@clinix/schemas";

export interface WeeklySlot {
  day_of_week: number; // 0 (Sun) – 6 (Sat)
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM"
}

export interface BookedSlot {
  start: Date;
  end: Date;
}

// ponytail: single fixed timezone (IST +05:30) for the prototype demo.
const IST_MS = (5 * 60 + 30) * 60 * 1000;

/** Applies date overrides, online working-hour intersections, closures, breaks and occupied intervals on the India calendar. */
export function computeSlots(
  template: WeeklySlot[],
  slotMinutes: number,
  from: Date,
  to: Date,
  booked: BookedSlot[],
  options?: { rules?: AvailabilityRules; appointmentType?: "ONLINE" | "IN_PERSON" },
): { start: Date; end: Date }[] {
  if (!Number.isFinite(slotMinutes) || slotMinutes <= 0) return [];
  const rules = options?.rules;
  const out: { start: Date; end: Date }[] = [];
  const step = slotMinutes * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;

  const startDay = new Date(from.getTime() + IST_MS);
  const endDay = new Date(to.getTime() + IST_MS);
  for (let t = startDay.getTime(); t <= endDay.getTime(); t += dayMs) {
    const shifted = new Date(t);
    const y = shifted.getUTCFullYear();
    const m = shifted.getUTCMonth();
    const d = shifted.getUTCDate();
    const dow = shifted.getUTCDay();

    const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (rules?.blocked_dates.some((row) => row.date === date)) continue;
    const override = rules?.overrides.find((row) => row.date === date);
    let windows = override ? override.intervals : template.filter((row) => row.day_of_week === dow);
    if (options?.appointmentType === "ONLINE" && rules?.online_template != null) {
      windows = windows.flatMap((row) => rules.online_template!.filter((online) => online.day_of_week === dow).map((online) => ({
        start_time: row.start_time > online.start_time ? row.start_time : online.start_time,
        end_time: row.end_time < online.end_time ? row.end_time : online.end_time,
      })).filter((row) => row.start_time < row.end_time));
    }
    const breaks = (rules?.breaks ?? []).filter((row) => row.day_of_week === dow).map((row) => {
      const [sh, sm] = row.start_time.split(":").map(Number);
      const [eh, em] = row.end_time.split(":").map(Number);
      return { start: Date.UTC(y, m, d, sh, sm) - IST_MS, end: Date.UTC(y, m, d, eh, em) - IST_MS };
    });
    for (const row of windows) {
      const [sh, sm] = row.start_time.split(":").map(Number);
      const [eh, em] = row.end_time.split(":").map(Number);
      const dayStartUtc = Date.UTC(y, m, d, sh, sm) - IST_MS;
      const dayEndUtc = Date.UTC(y, m, d, eh, em) - IST_MS;
      for (let s = dayStartUtc; s < dayEndUtc; s += step) {
        const e = s + step;
        if (e > dayEndUtc) break;
        if (s < from.getTime() || s > to.getTime()) continue;
        const overlaps = booked.some((b) => s < b.end.getTime() && b.start.getTime() < e);
        if (!overlaps && !breaks.some((pause) => s < pause.end && pause.start < e)) out.push({ start: new Date(s), end: new Date(e) });
      }
    }
  }
  return [...new Map(out.map((slot) => [slot.start.getTime(), slot])).values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}
