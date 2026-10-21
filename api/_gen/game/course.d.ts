import { distanceAfter, jumpPeak, PHYSICS, speedAt, type Hitbox } from "./physics.js";
/** Dead simple deterministic PRNG seeded from the course seed (splitmix32).
 *  No Math.random anywhere in this file. */
export declare function prng(seed: string): () => number;
export type ObstacleKind = {
    id: string;
    width: number;
    height: number;
    /** true = cleared by jumping, false = cleared by ducking under it */
    jumpable: boolean;
    /** px of clear track guaranteed after this kind */
    minGap: number;
    /** the kind is hidden until the world is this fast (px/frame) */
    minSpeed: number;
    /** above this world speed, groups of the kind may appear back to back */
    multipleSpeed: number;
};
export declare const OBSTACLES: ObstacleKind[];
/** The reference's opening mercy: no obstacle for the first three seconds,
 *  which at start speed is this many px of clear track. */
export declare const CLEAR_PX: number;
export type PlacedObstacle = {
    kind: ObstacleKind;
    x: number;
    /** the ground row the runner stands on is y = 0; obstacles sit above */
    hitbox: Hitbox;
};
/** Build the round's course. Pure function of the seed: the only source of
 *  variation is the seed itself. `lengthPx` is how long the run is. */
export declare function courseOf(seed: string, lengthPx: number): PlacedObstacle[];
/** Sanity rule a round must never break: every jumpable obstacle is shorter
 *  than the jump arc, and every gap is at least the kind's minimum. Used by
 *  the tests and available to the game at runtime. */
export declare function courseIsFair(course: PlacedObstacle[]): boolean;
export { distanceAfter, speedAt, PHYSICS, jumpPeak };
