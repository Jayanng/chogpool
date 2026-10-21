export declare const FRAME_MS: number;
export declare const PHYSICS: {
    /** px/frame² */
    readonly gravity: 0.6;
    /** px/frame, negative is up. Named correctly here, unlike Chromium. */
    readonly jumpVelocity: -10;
    /** px/frame at the start of a run */
    readonly startSpeed: 6;
    /** px/frame² gained per frame */
    readonly acceleration: 0.001;
    /** px/frame ceiling */
    readonly maxSpeed: 13;
};
/** World speed at a given distance travelled, in px/frame. The reference
 *  gains speed per frame, so the integral over distance is used here. */
export declare function speedAt(distancePx: number): number;
/** Distance covered after `frames` frames of running. */
export declare function distanceAfter(frames: number): number;
/** Height of the jump arc's peak, in px. */
export declare function jumpPeak(): number;
/** Frames from takeoff to the peak. */
export declare function framesToPeak(): number;
/** Total airborne frames for one jump. */
export declare function framesAirborne(): number;
export type Hitbox = {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** Axis-aligned hitbox overlap. The reference collides on hitboxes, not
 *  sprites, so the Chog and every obstacle collide on clear rectangles. */
export declare function overlaps(a: Hitbox, b: Hitbox): boolean;
