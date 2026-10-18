// Quiz timing (brief §4.1–§4.4). All instants are milliseconds since the epoch,
// taken from the server's clock; durations are in minutes and paces in seconds.

export const DURATIONS = Object.freeze([15, 30, 45, 60]);
export const PACES = Object.freeze([10, 15, 30, 45]);
export const PRIMARY_ONLY_PACE = 60;
export const TIERS = Object.freeze(['primary', 'secondary', 'tertiary']);
export const GRACE_DEFAULT = 3;
export const GRACE_MAX = 10;

export function allowedPaces(tier) {
  return tier === 'primary' ? [...PACES, PRIMARY_ONLY_PACE] : [...PACES];
}

/** Default question count N = 60·D/p. */
export function defaultCount(durationMin, paceSec) {
  return (60 * durationMin) / paceSec;
}

/**
 * Validates a quiz configuration; returns a list of error messages (empty = valid).
 * `available` is the number of approved questions in the quiz's selection.
 */
export function validateConfig({ tier, duration, pace, count, grace = GRACE_DEFAULT, available }) {
  const errors = [];
  if (!TIERS.includes(tier)) errors.push(`tier must be one of ${TIERS.join(', ')}`);
  if (!DURATIONS.includes(duration)) errors.push(`duration must be one of ${DURATIONS.join(', ')} minutes`);
  if (!allowedPaces(tier).includes(pace)) {
    errors.push(
      pace === PRIMARY_ONLY_PACE
        ? '60 seconds per question is allowed for primary-tier courses only'
        : `pace must be one of ${allowedPaces(tier).join(', ')} seconds`,
    );
  }
  if (errors.length === 0) {
    const max = defaultCount(duration, pace);
    if (!Number.isInteger(count) || count < 1 || count > max) {
      errors.push(`question count must be between 1 and ${max} for ${duration} min at ${pace} s`);
    } else if (available !== undefined && count > available) {
      errors.push(`only ${available} approved questions are available; ${count} are needed`);
    }
  }
  if (!Number.isInteger(grace) || grace < 0 || grace > GRACE_MAX) {
    errors.push(`grace must be a whole number of seconds from 0 to ${GRACE_MAX}`);
  }
  return errors;
}

/** Durations and paces that fit `available` questions at full length, for the quiz screen. */
export function fittingConfigs(tier, available) {
  const out = [];
  for (const d of DURATIONS) for (const p of allowedPaces(tier)) {
    const n = defaultCount(d, p);
    if (n <= available) out.push({ duration: d, pace: p, count: n });
  }
  return out;
}

/** Slot k (1-based) of an attempt: [open, close) in ms. */
export function slotWindow(t0, paceSec, k) {
  return { open: t0 + (k - 1) * paceSec * 1000, close: t0 + k * paceSec * 1000 };
}

/** The slot showing at `now`: 0 before T0, N+1 after the last slot closes. */
export function currentSlot(t0, paceSec, count, now) {
  if (now < t0) return 0;
  const k = Math.floor((now - t0) / (paceSec * 1000)) + 1;
  return k > count ? count + 1 : k;
}

/** Whether an answer for slot k received at `received` is accepted (o_k <= t <= c_k + g). */
export function acceptsAnswer(t0, paceSec, count, graceSec, k, received) {
  if (!Number.isInteger(k) || k < 1 || k > count) return false;
  const { open, close } = slotWindow(t0, paceSec, k);
  return received >= open && received <= close + graceSec * 1000;
}

/** The instant after which the attempt is final and may be graded. */
export function attemptEnd(t0, paceSec, count, graceSec) {
  return t0 + count * paceSec * 1000 + graceSec * 1000;
}
