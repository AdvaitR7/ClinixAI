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

/** Slots = weekly template minus booked appointments (contract §14 extension). */
export function computeSlots(
  template: WeeklySlot[],
  slotMinutes: number,
  from: Date,
  to: Date,
  booked: BookedSlot[],
): { start: Date; end: Date }[] {
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

    for (const row of template) {
      if (row.day_of_week !== dow) continue;
      const [sh, sm] = row.start_time.split(":").map(Number);
      const [eh, em] = row.end_time.split(":").map(Number);
      const dayStartUtc = Date.UTC(y, m, d, sh, sm) - IST_MS;
      const dayEndUtc = Date.UTC(y, m, d, eh, em) - IST_MS;
      for (let s = dayStartUtc; s < dayEndUtc; s += step) {
        const e = s + step;
        if (e > dayEndUtc) break;
        if (s < from.getTime() || s > to.getTime()) continue;
        const overlaps = booked.some((b) => s < b.end.getTime() && b.start.getTime() < e);
        if (!overlaps) out.push({ start: new Date(s), end: new Date(e) });
      }
    }
  }
  return out;
}
