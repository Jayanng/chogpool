// The run simulation. One pure step function: (state, inputs) -> state.
// Everything the game shows is a projection of these states, and because
// the step is deterministic, a run can be replayed exactly from its recorded
// inputs. That is what makes the leader's ghost free and what lets the Proof
// page re-run anyone's top finish and prove it happened.
import { courseOf, prng } from "./course.js";
import { distanceAfter, framesAirborne, framesToPeak, jumpPeak, overlaps, PHYSICS } from "./physics.js";
export const NO_INPUT = { jump: false, jumpHeld: false, duck: false };
export function initialRun() {
    return {
        frame: 0,
        distance: 0,
        height: 0,
        vy: 0,
        ducking: false,
        alive: true,
        score: 0,
        coins: 0,
        closeCalls: 0,
        juice: 0,
        invuln: 0,
    };
}
/** Revive: one per run. The Chog is lifted back over the obstacle it hit
 *  with a short invulnerable glide, keeping score, coins and close calls.
 *  The run's record says it was revived, so the leaderboard can mark it. */
export function revive(s) {
    return { ...s, alive: true, height: jumpPeak(), vy: 0, invuln: 90 };
}
const CHOG_W = 30;
const CHOG_H = 40;
const CHOG_H_DUCK = 22;
/** The runner's hitbox in world space at a state. */
export function chogBox(s) {
    const h = s.ducking && s.height === 0 ? CHOG_H_DUCK : CHOG_H;
    return { x: s.distance, y: s.height, w: CHOG_W, h };
}
/** Coins sit on the good racing line: just past each obstacle, at jump peak
 *  height for jumpables and at head height for gates. Generated from the
 *  same seed as the course, so the course and its coins are one object. */
export function coinsOf(course, seed) {
    const rand = prng(seed + "/coins");
    const coins = [];
    for (const o of course) {
        if (rand() < 0.72) {
            const y = o.kind.jumpable ? Math.round(jumpPeak() * 0.72) : 6;
            coins.push({ x: o.x + o.kind.width + 26, y, w: 14, h: 14 });
        }
    }
    return coins;
}
/** Advance one frame. Pure: same state and input, same result, forever. */
export function step(s, input, course, coins) {
    if (!s.alive)
        return s;
    const next = { ...s, frame: s.frame + 1 };
    next.invuln = Math.max(0, s.invuln - 1);
    // Variable jump height: the press lifts, the hold keeps lifting with half
    // gravity, releasing drops you. Tap for the short hop, hold for the arc.
    if (input.jump && s.height === 0) {
        next.vy = PHYSICS.jumpVelocity;
        next.height = 0.01;
        next.ducking = false;
    }
    else if (s.height > 0) {
        const g = input.jumpHeld && next.vy < 0 ? PHYSICS.gravity * 0.5 : PHYSICS.gravity;
        next.vy = s.vy + g;
        next.height = s.height - next.vy;
        if (next.height <= 0) {
            next.height = 0;
            next.vy = 0;
        }
    }
    next.ducking = input.duck && s.height === 0;
    next.distance = distanceAfter(next.frame);
    next.score = Math.floor(next.distance / 10) + next.coins * 25 + next.closeCalls * 15;
    const box = chogBox(next);
    for (const o of course) {
        const ox = o.hitbox.x;
        if (ox + o.hitbox.w < next.distance - CHOG_W)
            continue; // behind us
        if (ox > next.distance + 800)
            break; // too far ahead to matter
        // A revived Chog glides over the field: no hits, and no free close calls.
        if (next.invuln > 0)
            continue;
        if (overlaps(box, o.hitbox)) {
            next.alive = false;
            return next;
        }
        // A close call: the obstacle just passed through our pocket without a
        // hit. Reward the dangerous line.
        const pocket = { x: box.x - 8, y: box.y - 8, w: box.w + 16, h: box.h + 16 };
        if (!overlaps(box, o.hitbox) && overlaps(pocket, o.hitbox) && ox + o.hitbox.w < next.distance + CHOG_W / 2) {
            if (next.closeCalls <= Math.floor(next.distance / 2000)) {
                next.closeCalls += 1;
                next.juice = 12;
            }
        }
    }
    for (const c of coins) {
        if (overlaps(box, c))
            next.coins += 1;
    }
    return next;
}
/** Replay a whole run from its inputs. Given the round seed and the input
 *  tape, anyone rebuilds the exact final state: score, coins, close calls,
 *  distance. This is the fairness proof of a leaderboard entry. */
export function replay(seed, lengthPx, inputs) {
    const course = courseOf(seed, lengthPx);
    const coins = coinsOf(course, seed);
    let s = initialRun();
    for (const input of inputs) {
        s = step(s, input, course, coins);
        if (!s.alive)
            break;
    }
    return s;
}
export { jumpPeak, framesAirborne, framesToPeak };
