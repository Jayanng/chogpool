import { type PlacedObstacle } from "./course.js";
import { framesAirborne, framesToPeak, jumpPeak, type Hitbox } from "./physics.js";
export type Input = {
    /** jump pressed this frame */
    jump: boolean;
    /** jump held this frame (variable jump height: hold goes higher) */
    jumpHeld: boolean;
    /** duck held this frame */
    duck: boolean;
};
export declare const NO_INPUT: Input;
export type RunState = {
    frame: number;
    distance: number;
    /** px above the ground, 0 = feet down */
    height: number;
    vy: number;
    ducking: boolean;
    alive: boolean;
    score: number;
    coins: number;
    closeCalls: number;
    /** frames of slow motion earned by close calls */
    juice: number;
    /** frames of post-revive invulnerability */
    invuln: number;
};
export declare function initialRun(): RunState;
/** Revive: one per run. The Chog is lifted back over the obstacle it hit
 *  with a short invulnerable glide, keeping score, coins and close calls.
 *  The run's record says it was revived, so the leaderboard can mark it. */
export declare function revive(s: RunState): RunState;
/** The runner's hitbox in world space at a state. */
export declare function chogBox(s: RunState): Hitbox;
/** Coins sit on the good racing line: just past each obstacle, at jump peak
 *  height for jumpables and at head height for gates. Generated from the
 *  same seed as the course, so the course and its coins are one object. */
export declare function coinsOf(course: PlacedObstacle[], seed: string): Hitbox[];
/** Advance one frame. Pure: same state and input, same result, forever. */
export declare function step(s: RunState, input: Input, course: PlacedObstacle[], coins: Hitbox[]): RunState;
/** Replay a whole run from its inputs. Given the round seed and the input
 *  tape, anyone rebuilds the exact final state: score, coins, close calls,
 *  distance. This is the fairness proof of a leaderboard entry. */
export declare function replay(seed: string, lengthPx: number, inputs: Input[]): RunState;
export { jumpPeak, framesAirborne, framesToPeak };
