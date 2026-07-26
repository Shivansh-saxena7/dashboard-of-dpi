// Single source of truth for "is this location within the office
// geofence" — same pattern as the other lib/calculate*.ts files:
// pure function, no DB/network access, imported everywhere this
// decision is needed. The authoritative check runs server-side in
// the start-shift Edge Function; this same function can also be
// imported client-side purely for instant UI feedback, but the
// client's answer is never trusted for the actual gate.

const EARTH_RADIUS_METERS = 6371000;

export interface GeofenceCheckResult {
  distanceMeters: number;
  withinGeofence: boolean;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// Haversine formula — great-circle distance between two lat/lng points.
function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;

}

export function calculateGeofenceStatus(
  employeeLat: number,
  employeeLng: number,
  officeLat: number,
  officeLng: number,
  radiusMeters: number
): GeofenceCheckResult {

  const distanceMeters = haversineDistanceMeters(
    employeeLat,
    employeeLng,
    officeLat,
    officeLng
  );

  return {
    distanceMeters,
    withinGeofence: distanceMeters <= radiusMeters
  };

}
