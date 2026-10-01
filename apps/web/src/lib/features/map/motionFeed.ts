export interface MotionFeedInputs {
	smoothMotion: boolean;
	reduceMotion: boolean;
}

export function motionFeedAnimate({ smoothMotion, reduceMotion }: MotionFeedInputs): boolean {
	return smoothMotion && !reduceMotion;
}
