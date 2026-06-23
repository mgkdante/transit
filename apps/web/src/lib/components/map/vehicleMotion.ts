// map/vehicleMotion.ts — RE-EXPORT BARREL for the kinetic-motion engine.
//
// The engine was de-monolithed into the cohesive `motion/` subdomain:
//   · motion/constants.ts  — BLEND_MS / MIN_RENDER_INTERVAL_MS (+ projection consts)
//   · motion/easing.ts     — power1Out / normalizeBearing / blendBearing / roundCoordinate
//   · motion/projector.ts  — projectEntry + the VehicleEntry / BlendState / fix+shape types
//   · motion/runtime.ts    — MotionRuntime + the rAF/clock resolver
//   · motion/controller.ts — createVehicleMotionController + its options/controller types
//
// This file preserves the historical import surface (`from './vehicleMotion'`) so
// every call site — MapHero, the components/map barrel, vehicleMotion.test.ts —
// keeps working with no edit. Add new symbols to the motion/* modules and surface
// them here.

export { power1Out } from './motion/easing';
export type { MotionRuntime } from './motion/runtime';
export {
	projectEntry,
	type VehicleFix,
	type FixResolver,
	type ShapeResolver,
} from './motion/projector';
export {
	createVehicleMotionController,
	type VehicleMotionController,
	type VehicleMotionOptions,
} from './motion/controller';
