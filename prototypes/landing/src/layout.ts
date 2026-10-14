/** World-space coordinates shared by architecture and the inspection path. */
export type Point3 = [number, number, number];
export const entrance = {
  landingTop: .54,
  landingFront: 5.5,
  groundTop: .12,
  rampEnd: 8.15,
  rampX: -2.8,
  rampWidth: 1.65,
  stairX: -.9,
  stairWidth: 1.4,
  treadDepth: .4,
} as const;
export const rampHeightAt = (z: number) => entrance.landingTop +
  (entrance.groundTop - entrance.landingTop) * (z - entrance.landingFront) / (entrance.rampEnd - entrance.landingFront);
// The restroom door is in the front partition, between x=2.5 and x=4.4.
// Enter from z>0.725, then turn only after crossing that opening.
export const routes: Point3[][] = [
  [[-7.2, .155, 4.8], [-7.2, .155, 7.2], [-4.4, .155, 7.2]],
  [[-2.8, rampHeightAt(7.95) + .025, 7.95], [-2.8, .565, 5.5], [-2.8, .565, 4.7], [-1.9, .565, 4.7]],
  [[-1.9, .65, 3.4], [-1.9, .65, -2.8], [-.65, .65, -2.8]],
  [[-.9, .655, 1.25], [2.85, .655, 1.25], [2.85, .655, -.8]],
];
