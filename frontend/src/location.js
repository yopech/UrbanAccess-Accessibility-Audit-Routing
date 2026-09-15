export const LOCATION_CONFIG = Object.freeze({
  preciseAccuracyM: 35,
  acceptableAccuracyM: 100,
  maxSampleAgeMs: 30_000,
  settleTimeMs: 2_000,
  searchTimeMs: 10_000,
});

export function normalizeGeolocationPosition(position, now = Date.now()) {
  const latitude = Number(position?.coords?.latitude);
  const longitude = Number(position?.coords?.longitude);
  const accuracy = Number(position?.coords?.accuracy);
  const timestamp = Number(position?.timestamp);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(accuracy) || accuracy < 0 ||
      !Number.isFinite(timestamp) || timestamp > now + 5_000 || now - timestamp > LOCATION_CONFIG.maxSampleAgeMs) {
    return null;
  }

  return { latitude, longitude, accuracy, timestamp };
}

export function pickMoreAccurateSample(current, candidate) {
  if (!candidate) return current;
  if (!current || candidate.accuracy < current.accuracy ||
      (candidate.accuracy === current.accuracy && candidate.timestamp > current.timestamp)) {
    return candidate;
  }
  return current;
}

export function locationQuality(accuracy) {
  if (!Number.isFinite(accuracy) || accuracy > LOCATION_CONFIG.acceptableAccuracyM) return "POOR";
  if (accuracy <= LOCATION_CONFIG.preciseAccuracyM) return "PRECISE";
  return "ACCEPTABLE";
}
