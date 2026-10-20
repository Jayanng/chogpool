// The canvas renderer for the run. Presentation only: it draws the states
// the sim already decided, and every color on the Chog comes from its real
// trait appearance (chogArt.ts's honest boundary). Nothing here changes a
// score, a hit or a coin.

import type { ChogAppearance } from "../race/chogArt";
import type { PlacedObstacle } from "./course";
import type { RunState } from "./sim";

const PLAYER_X = 0.28;

export type Scene = {
  width: number;
  height: number;
  appearance: ChogAppearance;
  state: RunState;
  course: PlacedObstacle[];
  coins: Array<{ x: number; y: number; w: number; h: number }>;
  /** the recorded leader's run, when one exists on this course */
  ghost?: { state: RunState; appearance: ChogAppearance } | null;
  groundY: number;
  seedLabel: string;
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw one Chog in the world. The same appearance always draws the same
 *  mascot: body, belly, marking, perk, all from real trait values. */
function drawChog(
  ctx: CanvasRenderingContext2D,
  sx: number,
  groundY: number,
  height: number,
  frame: number,
  ducking: boolean,
  a: ChogAppearance,
  ghost: boolean,
) {
  const bob = height === 0 ? Math.sin(frame * 0.28) * 1.6 : 0;
  const y = groundY - height - 40 + bob;
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.34;

  if (a.aura) {
    const g = ctx.createRadialGradient(sx + 15, y + 20, 2, sx + 15, y + 20, 26 + 6 * a.auraStrength);
    g.addColorStop(0, `hsl(${a.hue} 70% 60% / ${0.16 + 0.3 * a.auraStrength})`);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(sx - 12, y - 8, 56, 60);
  }

  const squash = ducking ? 0.72 : 1;
  const bodyY = y + (ducking ? 10 : 0);
  const legSwing = height === 0 ? Math.sin(frame * 0.28) * 7 : 4;

  // legs
  ctx.fillStyle = a.accent;
  roundRect(ctx, sx + 6, bodyY + 30 * squash, 7, 12 * squash + legSwing * 0.4, 3);
  roundRect(ctx, sx + 18, bodyY + 30 * squash, 7, 12 * squash - legSwing * 0.4, 3);

  // ears
  ctx.fillStyle = a.body;
  ctx.strokeStyle = a.accent;
  ctx.lineWidth = 1.5;
  for (const ex of [sx + 2, sx + 22]) {
    ctx.beginPath();
    ctx.ellipse(ex + 4, bodyY + 4 * squash, 5, 8 * squash, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // body + belly
  ctx.fillStyle = a.body;
  ctx.beginPath();
  ctx.ellipse(sx + 15, bodyY + 20 * squash, 15, 15 * squash, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = a.belly;
  ctx.beginPath();
  ctx.ellipse(sx + 15, bodyY + 25 * squash, 9, 9 * squash, 0, 0, Math.PI * 2);
  ctx.fill();

  // marking from real trait values
  ctx.fillStyle = a.accent;
  ctx.globalAlpha *= a.marking === "none" ? 0 : 0.75;
  if (a.marking === "stripe") {
    ctx.beginPath();
    ctx.moveTo(sx + 15, bodyY + 8 * squash);
    ctx.lineTo(sx + 17, bodyY + 18 * squash);
    ctx.lineTo(sx + 13, bodyY + 18 * squash);
    ctx.closePath();
    ctx.fill();
  } else if (a.marking === "spots") {
    for (const [px, py] of [[7, 14], [23, 12]] as const) {
      ctx.beginPath();
      ctx.arc(sx + px, bodyY + py * squash, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (a.marking === "patch") {
    ctx.beginPath();
    ctx.ellipse(sx + 21, bodyY + 16 * squash, 5, 6 * squash, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // perk + eyes stay crisp even on the ghost
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.5;
  if (a.perk === "goggles") {
    ctx.fillStyle = a.accent;
    roundRect(ctx, sx + 8, bodyY + 11 * squash, 16, 6, 3);
    ctx.fill();
  } else if (a.perk === "bandana") {
    ctx.fillStyle = a.accent;
    roundRect(ctx, sx + 7, bodyY + 20 * squash, 18, 5, 2);
    ctx.fill();
  } else if (a.perk === "cape") {
    ctx.fillStyle = a.accent;
    ctx.globalAlpha *= 0.85;
    ctx.beginPath();
    ctx.moveTo(sx + 2, bodyY + 12 * squash);
    ctx.quadraticCurveTo(sx - 12, bodyY + 26, sx - 2, bodyY + 40);
    ctx.lineTo(sx + 6, bodyY + 30 * squash);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#1b1630";
  ctx.beginPath();
  ctx.arc(sx + 21, bodyY + 14 * squash, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draw the whole scene for one frame. */
export function drawScene(ctx: CanvasRenderingContext2D, s: Scene) {
  const { width: w, height: h, groundY, state } = s;
  const camX = state.distance - w * PLAYER_X;

  // sky: the app's grey-lilac world
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, "#211b3d");
  sky.addColorStop(0.62, "#4b3f7a");
  sky.addColorStop(1, "#8d7cc7");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, groundY);

  // parallax hills, deterministic from the seed label's length (stable, no
  // randomness per frame)
  ctx.fillStyle = "#2c2452";
  for (let i = -1; i < 8; i++) {
    const hx = ((i * 260 - camX * 0.32) % (w + 260)) - 130;
    ctx.beginPath();
    ctx.ellipse(hx, groundY - 10, 150, 60, 0, Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = "#372b66";
  for (let i = -1; i < 8; i++) {
    const hx = ((i * 340 - camX * 0.58) % (w + 340)) - 170;
    ctx.beginPath();
    ctx.ellipse(hx, groundY + 6, 190, 74, 0, Math.PI, 0);
    ctx.fill();
  }

  // ground
  ctx.fillStyle = "#171233";
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.fillStyle = "#9f8ade";
  ctx.fillRect(0, groundY, w, 3);
  // speed dashes
  ctx.fillStyle = "#6a58b8";
  for (let i = -1; i < 14; i++) {
    const dx = ((i * 120 - camX) % (w + 120)) - 60;
    ctx.fillRect(dx, groundY + 16, 54, 3);
  }

  // coins on the racing line
  for (const c of s.coins) {
    const cx = c.x - camX;
    if (cx < -40 || cx > w + 40) continue;
    const twinkle = 0.82 + 0.18 * Math.sin((state.distance + c.x) * 0.05);
    ctx.fillStyle = `rgba(198, 232, 92, ${twinkle})`;
    ctx.beginPath();
    ctx.arc(cx + c.w / 2, groundY - c.y - 7, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2c2452";
    ctx.beginPath();
    ctx.arc(cx + c.w / 2, groundY - c.y - 7, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // obstacles
  for (const o of s.course) {
    const ox = o.hitbox.x - camX;
    if (ox < -80 || ox > w + 80) continue;
    const oy = groundY - o.hitbox.y - o.hitbox.h;
    if (o.kind.jumpable) {
      ctx.fillStyle = o.kind.id === "crate" ? "#7a5cd6" : "#5646a8";
      roundRect(ctx, ox, oy, o.hitbox.w, o.hitbox.h, 6);
      ctx.fill();
      ctx.fillStyle = "#b9a6ff";
      roundRect(ctx, ox + 4, oy + 4, o.hitbox.w - 8, 6, 3);
      ctx.fill();
    } else {
      // the gate: a hanging beam, run under it
      ctx.fillStyle = "#d65c8a";
      roundRect(ctx, ox, oy, o.hitbox.w, o.hitbox.h, 6);
      ctx.fill();
      ctx.fillStyle = "#ffd2e2";
      roundRect(ctx, ox + 4, oy + o.hitbox.h - 10, o.hitbox.w - 8, 6, 3);
      ctx.fill();
    }
  }

  // the ghost of the best run on this course
  if (s.ghost) {
    drawChog(ctx, s.ghost.state.distance - camX, groundY, s.ghost.state.height, s.ghost.state.frame,
      s.ghost.state.ducking, s.ghost.appearance, true);
  }

  // the player
  drawChog(ctx, s.width * PLAYER_X, groundY, state.height, state.frame, state.ducking, s.appearance, false);

  // juice: the slow-motion tint earned by close calls
  if (state.juice > 0) {
    ctx.fillStyle = `rgba(198, 232, 92, ${Math.min(0.16, state.juice * 0.013)})`;
    ctx.fillRect(0, 0, w, h);
  }
}
