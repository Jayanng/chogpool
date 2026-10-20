// The canvas renderer for the run. Presentation only: it draws the states
// the sim already decided, and every color on the Chog comes from its real
// trait appearance (chogArt.ts's honest boundary). Nothing here changes a
// score, a hit or a coin.
//
// The look: a dusk stadium. Layered sky with a low sun, drifting clouds,
// parallax hills and trees, grounded shadows, rim-lit obstacles, and the
// juice: speed lines, screen shake, close-call wash, coin bursts.

import type { ChogAppearance } from "../race/chogArt";
import type { PlacedObstacle } from "./course";
import type { RunState } from "./sim";

const PLAYER_X = 0.26;

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
};

export type Popup = {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
};

export type Scene = {
  /** LOGICAL canvas size: the backing store may be scaled for DPI */
  width: number;
  height: number;
  scale?: number;
  appearance: ChogAppearance;
  state: RunState;
  course: PlacedObstacle[];
  coins: Array<{ x: number; y: number; w: number; h: number }>;
  ghost?: { state: RunState; appearance: ChogAppearance } | null;
  groundY: number;
  seedLabel: string;
  playerImage?: HTMLImageElement | null;
  ghostImage?: HTMLImageElement | null;
  particles?: Particle[];
  popups?: Popup[];
  shake?: number;
  progress?: number;
  lengthPx?: number;
};

/* ── particles ─────────────────────────────────────────────────────── */

export function spawnDust(list: Particle[], x: number, y: number, n = 4, color = "#c9b8ff") {
  for (let i = 0; i < n; i++) {
    list.push({
      x, y,
      vx: (Math.random() - 0.5) * 2.2,
      vy: -Math.random() * 1.6,
      life: 26 + Math.random() * 12,
      maxLife: 38,
      size: 3 + Math.random() * 4,
      color,
      gravity: 0.02,
    });
  }
}

export function spawnBurst(list: Particle[], x: number, y: number, color: string, n = 12, power = 3) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    list.push({
      x, y,
      vx: Math.cos(a) * (power * (0.5 + Math.random() * 0.8)),
      vy: Math.sin(a) * (power * (0.5 + Math.random() * 0.8)),
      life: 30 + Math.random() * 20,
      maxLife: 50,
      size: 2.5 + Math.random() * 3.5,
      color,
      gravity: 0.08,
    });
  }
}

export function spawnConfetti(list: Particle[], x: number, y: number, n = 40) {
  const colors = ["#c6e85c", "#9f8ade", "#ffd84d", "#f3a0c9", "#ffffff"];
  for (let i = 0; i < n; i++) {
    list.push({
      x: x + (Math.random() - 0.5) * 160,
      y: y - Math.random() * 60,
      vx: (Math.random() - 0.5) * 4,
      vy: -2 - Math.random() * 4,
      life: 70 + Math.random() * 50,
      maxLife: 120,
      size: 3 + Math.random() * 5,
      color: colors[i % colors.length],
      gravity: 0.12,
    });
  }
}

function stepParticles(list: Particle[]) {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.life -= 1;
    if (p.life <= 0) list.splice(i, 1);
  }
}

/* ── primitives ────────────────────────────────────────────────────── */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, lift: number) {
  const k = Math.max(0.25, 1 - lift / 220);
  ctx.fillStyle = `rgba(12, 8, 30, ${0.34 * k})`;
  ctx.beginPath();
  ctx.ellipse(x, y, w * (0.75 + 0.25 * k), w * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
}

/* ── the runner ────────────────────────────────────────────────────── */

/** The runner as its real self: the Chog's actual IPFS image, animated to
 *  run. It bobs on the ground, leans in the air, squashes to duck. */
function drawChogImage(
  ctx: CanvasRenderingContext2D,
  sx: number,
  groundY: number,
  height: number,
  frame: number,
  ducking: boolean,
  img: HTMLImageElement,
  ghost: boolean,
) {
  const size = 64;
  const bob = height === 0 ? Math.sin(frame * 0.3) * 2.4 : 0;
  const y = groundY - height - size + bob + (ducking ? 10 : 0);
  shadow(ctx, sx + size / 2, groundY + 4, 26, height);
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.32;
  ctx.translate(sx + size / 2, y + size / 2);
  if (ducking) ctx.scale(1, 0.72);
  ctx.rotate(height > 0 ? -0.14 : Math.sin(frame * 0.3) * 0.05);
  ctx.shadowColor = "rgba(198, 232, 92, 0.5)";
  ctx.shadowBlur = 14;
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/** The derived sprite, the honest fallback when the image cannot load. */
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
  const bob = height === 0 ? Math.sin(frame * 0.3) * 2 : 0;
  const y = groundY - height - 44 + bob;
  shadow(ctx, sx + 17, groundY + 4, 24, height);
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.32;

  const squash = ducking ? 0.72 : 1;
  const bodyY = y + (ducking ? 12 : 0);
  const legSwing = height === 0 ? Math.sin(frame * 0.3) * 8 : 5;

  if (a.aura) {
    const g = ctx.createRadialGradient(sx + 17, bodyY + 22, 2, sx + 17, bodyY + 22, 30 + 6 * a.auraStrength);
    g.addColorStop(0, `hsl(${a.hue} 70% 60% / ${0.16 + 0.3 * a.auraStrength})`);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(sx - 14, bodyY - 10, 62, 66);
  }

  // legs
  ctx.fillStyle = a.accent;
  roundRect(ctx, sx + 6, bodyY + 32 * squash, 8, 13 * squash + legSwing * 0.4, 3);
  ctx.fill();
  roundRect(ctx, sx + 20, bodyY + 32 * squash, 8, 13 * squash - legSwing * 0.4, 3);
  ctx.fill();

  // ears
  ctx.fillStyle = a.body;
  ctx.strokeStyle = a.accent;
  ctx.lineWidth = 1.5;
  for (const ex of [sx + 2, sx + 23]) {
    ctx.beginPath();
    ctx.ellipse(ex + 5, bodyY + 5 * squash, 5.5, 9 * squash, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // body + belly
  ctx.fillStyle = a.body;
  ctx.beginPath();
  ctx.ellipse(sx + 17, bodyY + 21 * squash, 16, 16 * squash, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = a.belly;
  ctx.beginPath();
  ctx.ellipse(sx + 17, bodyY + 26 * squash, 10, 10 * squash, 0, 0, Math.PI * 2);
  ctx.fill();

  // marking from real trait values
  ctx.fillStyle = a.accent;
  ctx.globalAlpha *= a.marking === "none" ? 0 : 0.75;
  if (a.marking === "stripe") {
    ctx.beginPath();
    ctx.moveTo(sx + 17, bodyY + 9 * squash);
    ctx.lineTo(sx + 19, bodyY + 19 * squash);
    ctx.lineTo(sx + 15, bodyY + 19 * squash);
    ctx.closePath();
    ctx.fill();
  } else if (a.marking === "spots") {
    for (const [px, py] of [[8, 15], [25, 13]] as const) {
      ctx.beginPath();
      ctx.arc(sx + px, bodyY + py * squash, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (a.marking === "patch") {
    ctx.beginPath();
    ctx.ellipse(sx + 23, bodyY + 17 * squash, 5, 6 * squash, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // perk + eyes stay crisp even on the ghost
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.5;
  if (a.perk === "goggles") {
    ctx.fillStyle = a.accent;
    roundRect(ctx, sx + 9, bodyY + 12 * squash, 17, 6, 3);
    ctx.fill();
  } else if (a.perk === "bandana") {
    ctx.fillStyle = a.accent;
    roundRect(ctx, sx + 8, bodyY + 21 * squash, 19, 5, 2);
    ctx.fill();
  } else if (a.perk === "cape") {
    ctx.fillStyle = a.accent;
    ctx.globalAlpha *= 0.85;
    ctx.beginPath();
    ctx.moveTo(sx + 3, bodyY + 13 * squash);
    ctx.quadraticCurveTo(sx - 12, bodyY + 28, sx - 1, bodyY + 43);
    ctx.lineTo(sx + 7, bodyY + 32 * squash);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#1b1630";
  ctx.beginPath();
  ctx.arc(sx + 23, bodyY + 15 * squash, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ── the world ─────────────────────────────────────────────────────── */

function drawSky(ctx: CanvasRenderingContext2D, w: number, groundY: number, camX: number, frame: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, "#171136");
  sky.addColorStop(0.42, "#4b3a8e");
  sky.addColorStop(0.78, "#b57bd6");
  sky.addColorStop(1, "#ffc98f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, groundY);

  // the low sun
  const sunX = w * 0.78;
  const sunY = groundY * 0.58;
  const glow = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 190);
  glow.addColorStop(0, "rgba(255, 214, 150, 0.95)");
  glow.addColorStop(0.25, "rgba(255, 180, 120, 0.4)");
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(sunX - 200, sunY - 200, 400, 400);
  ctx.fillStyle = "#ffe9c4";
  ctx.beginPath();
  ctx.arc(sunX, sunY, 32, 0, Math.PI * 2);
  ctx.fill();

  // drifting cloud banks, two depths
  for (const [depth, alpha, tint] of [[0.18, 0.5, "#6b58b8"], [0.34, 0.72, "#8d74d4"]] as const) {
    ctx.fillStyle = tint;
    ctx.globalAlpha = alpha;
    for (let i = -1; i < 6; i++) {
      const base = i * 320 - ((camX * depth + frame * depth * 0.35) % 320);
      const cy = groundY * (0.16 + (((i * 37) % 3) + 3) % 3 * 0.09);
      ctx.beginPath();
      ctx.ellipse(base, cy, 90, 24, 0, 0, Math.PI * 2);
      ctx.ellipse(base + 55, cy - 12, 70, 22, 0, 0, Math.PI * 2);
      ctx.ellipse(base - 50, cy + 4, 60, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawParallax(ctx: CanvasRenderingContext2D, w: number, groundY: number, camX: number) {
  // far hills
  ctx.fillStyle = "#2c2260";
  for (let i = -1; i < 8; i++) {
    const hx = ((i * 300 - camX * 0.22) % (w + 300)) - 150;
    ctx.beginPath();
    ctx.ellipse(hx, groundY - 6, 170, 74, 0, Math.PI, 0);
    ctx.fill();
  }
  // near hills
  ctx.fillStyle = "#3d2f7d";
  for (let i = -1; i < 8; i++) {
    const hx = ((i * 380 - camX * 0.42) % (w + 380)) - 190;
    ctx.beginPath();
    ctx.ellipse(hx, groundY + 12, 210, 86, 0, Math.PI, 0);
    ctx.fill();
  }
  // trees
  for (let i = -1; i < 10; i++) {
    const tx = ((i * 260 - camX * 0.62) % (w + 260)) - 130;
    const ty = groundY - 2;
    const th = 60 + (((i * 53) % 40) + 40) % 40;
    ctx.fillStyle = "#241b4d";
    ctx.fillRect(tx - 4, ty - th * 0.45, 8, th * 0.45);
    ctx.beginPath();
    ctx.arc(tx, ty - th * 0.55, th * 0.34, 0, Math.PI * 2);
    ctx.arc(tx - th * 0.22, ty - th * 0.38, th * 0.24, 0, Math.PI * 2);
    ctx.arc(tx + th * 0.22, ty - th * 0.38, th * 0.24, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGround(ctx: CanvasRenderingContext2D, w: number, h: number, groundY: number, camX: number) {
  const gnd = ctx.createLinearGradient(0, groundY, 0, h);
  gnd.addColorStop(0, "#241b4d");
  gnd.addColorStop(1, "#140f2e");
  ctx.fillStyle = gnd;
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.fillStyle = "rgba(159, 232, 120, 0.9)";
  ctx.fillRect(0, groundY - 2, w, 3);
  ctx.fillStyle = "rgba(159, 138, 222, 0.5)";
  for (let i = -1; i < 16; i++) {
    const dx = ((i * 120 - camX) % (w + 120)) - 60;
    ctx.fillRect(dx, groundY + 20, 56, 3);
  }
}

function drawObstacle(ctx: CanvasRenderingContext2D, o: PlacedObstacle, ox: number, groundY: number) {
  const w = o.hitbox.w;
  const h = o.hitbox.h;
  const oy = groundY - o.hitbox.y - h;
  shadow(ctx, ox + w / 2, groundY + 4, w * 0.9, 0);
  if (o.kind.jumpable) {
    const crate = o.kind.id === "crate";
    const grad = ctx.createLinearGradient(ox, oy, ox, oy + h);
    grad.addColorStop(0, crate ? "#8f6df0" : "#6a55c9");
    grad.addColorStop(1, crate ? "#5b3fb8" : "#3f2f8e");
    ctx.fillStyle = grad;
    roundRect(ctx, ox, oy, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(198, 232, 120, 0.55)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, ox + 1, oy + 1, w - 2, h - 2, 6);
    ctx.stroke();
    if (crate) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
      roundRect(ctx, ox + 4, oy + 5, w - 8, 6, 3);
      ctx.fill();
      roundRect(ctx, ox + 4, oy + h / 2 - 3, w - 8, 6, 3);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
      ctx.beginPath();
      ctx.ellipse(ox + w * 0.36, oy + h * 0.28, w * 0.22, h * 0.16, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // the hanging gate: posts, beam, hazard glow
    ctx.fillStyle = "#3a2a72";
    roundRect(ctx, ox, oy, 6, h, 3);
    ctx.fill();
    roundRect(ctx, ox + w - 6, oy, 6, h, 3);
    ctx.fill();
    const beam = ctx.createLinearGradient(ox, oy + h - 14, ox, oy + h);
    beam.addColorStop(0, "#f0679c");
    beam.addColorStop(1, "#c23b73");
    ctx.fillStyle = beam;
    roundRect(ctx, ox - 2, oy + h - 14, w + 4, 14, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 220, 235, 0.85)";
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(ox + 4 + i * (w / 3), oy + h - 8);
      ctx.rotate(0.5);
      ctx.fillRect(0, -2, 8, 4);
      ctx.restore();
    }
    ctx.fillStyle = "rgba(240, 103, 156, 0.14)";
    ctx.fillRect(ox - 2, oy + h, w + 4, 42);
  }
}

function drawCoin(ctx: CanvasRenderingContext2D, c: { x: number; y: number; w: number; h: number }, camX: number, groundY: number, frame: number) {
  const cx = c.x - camX + c.w / 2;
  const cy = groundY - c.y - c.h / 2;
  const spin = 0.45 + 0.55 * Math.abs(Math.sin(frame * 0.07 + c.x * 0.02));
  const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 17);
  glow.addColorStop(0, "rgba(198, 232, 92, 0.5)");
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 18, cy - 18, 36, 36);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(spin, 1);
  ctx.fillStyle = "#c6e85c";
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2c2452";
  ctx.beginPath();
  ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFinish(ctx: CanvasRenderingContext2D, x: number, groundY: number, frame: number) {
  // a checkered gantry at the course's end
  ctx.fillStyle = "#241b4d";
  ctx.fillRect(x - 5, groundY - 150, 10, 150);
  ctx.fillRect(x + 60, groundY - 150, 10, 150);
  const cells = 8;
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < cells; i++) {
      ctx.fillStyle = (i + r) % 2 === 0 ? "#f4f0ff" : "#2c2452";
      ctx.fillRect(x + 5 + i * 8.75, groundY - 150 + r * 12, 9, 12);
    }
  }
  // a fluttering flag
  const wave = Math.sin(frame * 0.12) * 5;
  ctx.fillStyle = "#c6e85c";
  ctx.beginPath();
  ctx.moveTo(x + 10, groundY - 165);
  ctx.lineTo(x + 46 + wave, groundY - 158);
  ctx.lineTo(x + 10, groundY - 148);
  ctx.closePath();
  ctx.fill();
}

/* ── the scene ─────────────────────────────────────────────────────── */

export function drawScene(ctx: CanvasRenderingContext2D, s: Scene) {
  const scale = s.scale ?? 1;
  const { width: w, height: h, groundY, state } = s;
  const camX = state.distance - w * PLAYER_X;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.save();
  const shake = s.shake ?? 0;
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 10);
  }

  drawSky(ctx, w, groundY, camX, state.frame);
  drawParallax(ctx, w, groundY, camX);
  drawGround(ctx, w, h, groundY, camX);

  if (typeof s.lengthPx === "number") {
    const fx = s.lengthPx - camX;
    if (fx > -120 && fx < w + 120) drawFinish(ctx, fx, groundY, state.frame);
  }

  for (const c of s.coins) {
    const cx = c.x - camX;
    if (cx < -40 || cx > w + 40) continue;
    drawCoin(ctx, c, camX, groundY, state.frame);
  }

  for (const o of s.course) {
    const ox = o.hitbox.x - camX;
    if (ox < -80 || ox > w + 80) continue;
    drawObstacle(ctx, o, ox, groundY);
  }

  // the ghost of the best run on this course
  if (s.ghost) {
    const gx = s.ghost.state.distance - camX;
    if (s.ghostImage && s.ghostImage.complete && s.ghostImage.naturalWidth > 0) {
      drawChogImage(ctx, gx, groundY, s.ghost.state.height, s.ghost.state.frame,
        s.ghost.state.ducking, s.ghostImage, true);
    } else {
      drawChog(ctx, gx, groundY, s.ghost.state.height, s.ghost.state.frame,
        s.ghost.state.ducking, s.ghost.appearance, true);
    }
  }

  // the player: its real image when it loaded, the derived sprite if not
  const px = w * PLAYER_X;
  if (s.playerImage && s.playerImage.complete && s.playerImage.naturalWidth > 0) {
    drawChogImage(ctx, px, groundY, state.height, state.frame, state.ducking, s.playerImage, false);
  } else {
    drawChog(ctx, px, groundY, state.height, state.frame, state.ducking, s.appearance, false);
  }

  // particles
  if (s.particles && s.particles.length > 0) {
    for (const p of s.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    stepParticles(s.particles);
  }

  // score popups
  if (s.popups && s.popups.length > 0) {
    for (const p of s.popups) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
      ctx.fillStyle = p.color;
      ctx.font = "700 18px 'Plus Jakarta Sans', system-ui, sans-serif";
      ctx.fillText(p.text, p.x, p.y);
      p.y -= 0.7;
      p.life -= 1;
    }
    ctx.globalAlpha = 1;
    for (let i = s.popups.length - 1; i >= 0; i--) {
      if (s.popups[i].life <= 0) s.popups.splice(i, 1);
    }
  }

  // speed lines at pace
  if (state.alive && state.distance > 0) {
    const speed = Math.min(1, state.distance / 30000);
    if (speed > 0.35) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.06 + speed * 0.1})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const ly = groundY * 0.25 + (((state.frame * 2.2 + i * 97) % (groundY * 0.62)) + groundY) % groundY;
        const lx = ((state.frame * (5 + i * 2.2)) % (w + 200)) - 100;
        ctx.beginPath();
        ctx.moveTo(w - lx, ly);
        ctx.lineTo(w - lx + 60 + speed * 80, ly);
        ctx.stroke();
      }
    }
  }

  // the close-call / slow-motion wash
  if (state.juice > 0) {
    const k = Math.min(1, state.juice / 18);
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.32, w / 2, h / 2, h * 0.85);
    vig.addColorStop(0, "transparent");
    vig.addColorStop(1, `rgba(198, 232, 92, ${0.16 * k})`);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);
  }

  // the progress bar
  if (typeof s.progress === "number") {
    ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
    ctx.fillRect(0, 0, w, 5);
    ctx.fillStyle = "#c6e85c";
    ctx.fillRect(0, 0, w * Math.max(0, Math.min(1, s.progress)), 5);
  }

  ctx.restore();
}
