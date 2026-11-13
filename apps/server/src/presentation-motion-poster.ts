import type { SKRSContext2D } from "@napi-rs/canvas";
import type { PresentationSceneDesign } from "@openround/contracts";

// Original, fixed-phase compositions. Only closed design tokens reach this painter;
// it never loads media or depends on the clock, randomness, or browser animation.
const accents = {
  paper: ["#7587d4", "#6aa69b", "#bc8fbd"],
  midnight: ["#6f8edb", "#57b9b1", "#ae8fca"],
  ocean: ["#4f9fb2", "#65b5a5", "#8b98ca"],
  sunset: ["#d69072", "#ce91a4", "#b5a078"],
} as const;

function translucent(color: string, alpha: number) {
  const channels = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
  return `rgba(${channels.join(",")},${alpha})`;
}

/** Paint behind content, after its established theme base, at the canonical still phase. */
export function paintPresentationMotionPoster(
  ctx: SKRSContext2D,
  design: PresentationSceneDesign,
  width: number,
  height: number,
) {
  if (!design.motionBackground) return;
  const [a, b, c] = accents[design.theme];
  ctx.save();
  ctx.scale(width / 1280, height / 720);
  ctx.beginPath();
  ctx.rect(0, 0, 1280, 720);
  ctx.clip();

  const glow = (
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    color: string,
    alpha: number,
  ) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(radiusX, radiusY);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, translucent(color, alpha));
    gradient.addColorStop(0.45, translucent(color, alpha * 0.65));
    gradient.addColorStop(1, translucent(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  };

  switch (design.motionBackground) {
    case "aurora":
      glow(307, 58, 650, 280, a, 0.16);
      glow(1050, 216, 540, 360, b, 0.14);
      glow(538, 720, 760, 260, c, 0.12);
      break;
    case "waves":
      for (const [index, color] of [a, b, c].entries()) {
        const top = 425 + index * 80;
        ctx.beginPath();
        ctx.moveTo(-40, top);
        ctx.bezierCurveTo(280, top - 130, 480, top + 130, 800, top + 10);
        ctx.bezierCurveTo(1020, top - 70, 1170, top - 80, 1320, top - 30);
        ctx.lineTo(1320, 760);
        ctx.lineTo(-40, 760);
        ctx.closePath();
        ctx.fillStyle = translucent(color, 0.07);
        ctx.fill();
      }
      break;
    case "orbs":
      glow(154, 180, 190, 190, a, 0.18);
      glow(1101, 490, 240, 240, b, 0.16);
      glow(832, 86, 130, 130, c, 0.14);
      break;
    case "mesh":
      glow(64, 36, 640, 396, a, 0.16);
      glow(1216, 36, 640, 396, b, 0.14);
      glow(1152, 720, 640, 396, c, 0.16);
      glow(128, 720, 640, 396, b, 0.12);
      ctx.strokeStyle = translucent(a, 0.035);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let column = 1; column <= 5; column++) {
        ctx.moveTo((1280 * column) / 6, 0);
        ctx.lineTo((1280 * column) / 6, 720);
      }
      for (let row = 1; row <= 4; row++) {
        ctx.moveTo(0, (720 * row) / 5);
        ctx.lineTo(1280, (720 * row) / 5);
      }
      ctx.stroke();
      break;
    case "ribbons":
      ctx.lineCap = "round";
      for (const [index, color] of [a, b, c].entries()) {
        const shift = index * 92;
        ctx.beginPath();
        ctx.moveTo(-80, 650 + shift);
        ctx.bezierCurveTo(350, 380 + shift, 730, 900 - shift, 1360, 300 + shift);
        ctx.strokeStyle = translucent(color, 0.09);
        ctx.lineWidth = 46;
        ctx.stroke();
      }
      break;
    case "stars":
      glow(1100, 90, 430, 320, a, 0.09);
      for (let index = 0; index < 24; index++) {
        // Fixed modular positions give a sparse field without a random generator.
        const x = 48 + ((index * 277) % 1180),
          y = 36 + ((index * 113) % 650);
        ctx.fillStyle = translucent([a, b, c][index % 3]!, 0.18);
        if (index % 4 === 0) {
          ctx.fillRect(x - 4, y - 0.75, 8, 1.5);
          ctx.fillRect(x - 0.75, y - 4, 1.5, 8);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, index % 3 === 0 ? 2 : 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
  }
  ctx.restore();
}
