// Lengths in metres. All poses are functions of travelled distance, never wall time.
export const WHEEL_RADIUS = 0.38;
export const TRACK_RADIUS = 0.30;
export const TRACK_HALF_LENGTH = 0.85;
export const TRACK_CENTER_Y = 0.34;
export const TRACK_LENGTH = 4 * TRACK_HALF_LENGTH + 2 * Math.PI * TRACK_RADIUS;
export const STRIDE = 1.2;
export const STANCE = 0.78; // Four staggered legs: at least three ground contacts.
export const UPPER_LEG = 0.58;
export const LOWER_LEG = 0.62;
export type Point3 = readonly [number, number, number];
export const positiveModulo = (value: number, period: number): number => ((value % period) + period) % period;

export function trackPose(distance: number): { x: number; y: number; angle: number } {
  const a = TRACK_HALF_LENGTH, r = TRACK_RADIUS;
  let s = positiveModulo(distance, TRACK_LENGTH);
  if (s < 2 * a) return { x: -a + s, y: TRACK_CENTER_Y + r, angle: 0 };
  s -= 2 * a;
  if (s < Math.PI * r) {
    const turn = s / r;
    return { x: a + r * Math.sin(turn), y: TRACK_CENTER_Y + r * Math.cos(turn), angle: -turn };
  }
  s -= Math.PI * r;
  if (s < 2 * a) return { x: a - s, y: TRACK_CENTER_Y - r, angle: -Math.PI };
  s -= 2 * a;
  const turn = s / r;
  return { x: -a - r * Math.sin(turn), y: TRACK_CENTER_Y - r * Math.cos(turn), angle: -Math.PI - turn };
}

export function footPose(xM: number, originXM: number, homeXM: number, offset: number) {
  const cycle = (xM - originXM) / STRIDE + offset;
  const index = Math.floor(cycle), phase = cycle - index;
  const anchor = originXM + homeXM + (index + STANCE / 2 - offset) * STRIDE;
  const swing = Math.max(0, (phase - STANCE) / (1 - STANCE));
  const blend = swing ** 3 * (10 - 15 * swing + 6 * swing ** 2);
  return { xM: anchor + STRIDE * blend, liftM: 0.20 * Math.sin(Math.PI * swing) ** 2,
    planted: phase <= STANCE, phase };
}

// Two rigid links, analytic IK. Project the preferred knee direction onto the hip/ankle plane.
export function kneePosition(hip: Point3, ankle: Point3, bend: number): Point3 {
  const delta = ankle.map((v, i) => v - hip[i]);
  const distance = Math.hypot(...delta);
  if (distance < 1e-8 || distance > UPPER_LEG + LOWER_LEG || distance < Math.abs(UPPER_LEG - LOWER_LEG)) {
    throw new RangeError('Foot target outside leg reach');
  }
  const direction = delta.map(v => v / distance);
  const along = (UPPER_LEG ** 2 - LOWER_LEG ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, UPPER_LEG ** 2 - along ** 2));
  const preferred = [bend, 0, 0];
  const dot = preferred[0] * direction[0];
  const normal = preferred.map((v, i) => v - dot * direction[i]);
  const length = Math.hypot(...normal);
  return hip.map((v, i) => v + along * direction[i] + height * normal[i] / length) as unknown as Point3;
}
