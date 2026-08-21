const CAPTURE_DATE = "2026-08-24";
const CAPTURE_TIME_ZONE = "America/Toronto";
const CAPTURE_LABEL = "weekday-rush";
const CAPTURE_START_HOUR = 6;
const CAPTURE_END_HOUR = 9;
export const E6_SOURCE_BASE = "https://data.yesid.dev/v1";
export const E6_PROVIDER = "stm";
const ISO_INSTANT =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d{1,3})?(?:Z|(?<offsetSign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u;

function fail(message) {
  throw new Error(message);
}

export function parseIsoInstant(value) {
  const parts =
    typeof value === "string" ? ISO_INSTANT.exec(value)?.groups : null;
  if (!parts) return Number.NaN;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const offsetHour = Number(parts.offsetHour ?? 0);
  const offsetMinute = Number(parts.offsetMinute ?? 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  if (
    year < 1 ||
    !daysInMonth ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0) ||
    (parts.offsetSign === "-" && offsetHour === 0 && offsetMinute === 0)
  ) {
    return Number.NaN;
  }
  return Date.parse(value);
}

export function isIsoInstantString(value) {
  return typeof value === "string" && ISO_INSTANT.test(value);
}

function localCaptureParts(capturedUtc) {
  const epoch = parseIsoInstant(capturedUtc);
  if (!Number.isFinite(epoch)) fail("E6_CAPTURE_INSTANT_INVALID");
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: CAPTURE_TIME_ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "long",
    })
      .formatToParts(new Date(epoch))
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return {
    localDate: `${values.year}-${values.month}-${values.day}`,
    localTime: `${values.hour}:${values.minute}:${values.second}`,
    localHour: Number(values.hour),
    weekday: values.weekday,
  };
}

export function evaluateCaptureGate({ sourceKind, capturedUtc, label } = {}) {
  const { localDate, localTime, localHour, weekday } =
    localCaptureParts(capturedUtc);
  return {
    eligible:
      sourceKind === "live" &&
      label === CAPTURE_LABEL &&
      localDate === CAPTURE_DATE &&
      localHour >= CAPTURE_START_HOUR &&
      localHour < CAPTURE_END_HOUR &&
      weekday === "Monday",
    label: label ?? null,
    timeZone: CAPTURE_TIME_ZONE,
    capturedUtc,
    localDate,
    localTime,
    weekday,
  };
}

export function isCaptureWindowInstant(capturedUtc) {
  try {
    return evaluateCaptureGate({
      sourceKind: "live",
      capturedUtc,
      label: CAPTURE_LABEL,
    }).eligible;
  } catch {
    return false;
  }
}
