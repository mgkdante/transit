const baseVehicles = 856;
const scaleLanes = 4;

// One binding fleet shape is shared by capture, validation, configuration,
// and synthetic replay. Keeping it here prevents those paths from drifting.
export const B2_FLEET_CONTRACT = Object.freeze({
  baseVehicles,
  scaleLanes,
  fleetVehicles: baseVehicles * scaleLanes,
  identityOrder: "vehicle.id code-point ascending",
});

export function codePointCompare(left, right) {
  const leftPoints = [...left].map((value) => value.codePointAt(0));
  const rightPoints = [...right].map((value) => value.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index])
      return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}
