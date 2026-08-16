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
