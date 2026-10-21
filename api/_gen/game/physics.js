// The run physics, referenced from a proven browser runner: Chrome's T-Rex
// (Chromium's offline game). The constants below are the ones that shipped
// in Chromium's Trex.config / Runner.config, in pixels per 60fps frame:
// GRAVITY 0.6, INIITAL_JUMP_VELOCITY -10 (sic), SPEED 6, ACCELERATION 0.001,
// MAX_SPEED 13. We keep the exact shape of that jump arc because it is the
// arc players already know: peak about 83px, about 0.28s up. Everything
// here is pure: the same values, the same arc, on every device.
export const FRAME_MS = 1000 / 60;
export const PHYSICS = {
    /** px/frame² */
    gravity: 0.6,
    /** px/frame, negative is up. Named correctly here, unlike Chromium. */
    jumpVelocity: -10,
    /** px/frame at the start of a run */
    startSpeed: 6,
    /** px/frame² gained per frame */
    acceleration: 0.001,
    /** px/frame ceiling */
    maxSpeed: 13,
};
/** World speed at a given distance travelled, in px/frame. The reference
 *  gains speed per frame, so the integral over distance is used here. */
export function speedAt(distancePx) {
    const { startSpeed, acceleration, maxSpeed } = PHYSICS;
    // frames ≈ distance / average speed; iterate once, it is a mild curve.
    const avg = (startSpeed + maxSpeed) / 2;
    const frames = distancePx / avg;
    return Math.min(maxSpeed, startSpeed + acceleration * frames);
}
/** Distance covered after `frames` frames of running. */
export function distanceAfter(frames) {
    return frames * PHYSICS.startSpeed + PHYSICS.acceleration * ((frames * (frames - 1)) / 2);
}
/** Height of the jump arc's peak, in px. */
export function jumpPeak() {
    const v = PHYSICS.jumpVelocity;
    return (v * v) / (2 * PHYSICS.gravity);
}
/** Frames from takeoff to the peak. */
export function framesToPeak() {
    return -PHYSICS.jumpVelocity / PHYSICS.gravity;
}
/** Total airborne frames for one jump. */
export function framesAirborne() {
    return 2 * framesToPeak();
}
/** Axis-aligned hitbox overlap. The reference collides on hitboxes, not
 *  sprites, so the Chog and every obstacle collide on clear rectangles. */
export function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
