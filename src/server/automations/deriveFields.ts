// Virtual reservation fields computed at evaluation time.
//
// Flat conditions can't do arithmetic between two date columns, so
// "stay length >= 5" / "vacancy >= 5" / "checkout in 2 days" aren't
// expressible against raw columns. We compute these per-row right before
// conditions/render run. They are NOT stored columns — single source of
// truth for both the event path (run.ts) and the scan path
// (runSchedule.ts).
//
// All values are integer days. Fields that can't be computed (missing
// dates) are omitted so `is_empty` conditions behave sensibly.

function ymdToUtcMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function diffDays(aMs: number | null, bMs: number | null): number | null {
  if (aMs === null || bMs === null) return null;
  return Math.round((aMs - bMs) / 86_400_000);
}

export function withDerivedReservationFields(
  row: Record<string, unknown>,
  todayYmd: string,
): Record<string, unknown> {
  const checkIn = ymdToUtcMs(row.check_in);
  const checkOut = ymdToUtcMs(row.check_out);
  const nextCheckIn = ymdToUtcMs(row.next_check_in);
  const today = ymdToUtcMs(todayYmd);

  const out: Record<string, unknown> = { ...row };

  const stay = diffDays(checkOut, checkIn);
  if (stay !== null) out.stay_length_days = stay;

  const vacancy = diffDays(nextCheckIn, checkOut);
  if (vacancy !== null) out.vacancy_days = vacancy;

  const untilIn = diffDays(checkIn, today);
  if (untilIn !== null) out.days_until_check_in = untilIn;

  const untilOut = diffDays(checkOut, today);
  if (untilOut !== null) out.days_until_check_out = untilOut;

  const untilNext = diffDays(nextCheckIn, today);
  if (untilNext !== null) out.days_until_next_check_in = untilNext;

  return out;
}
