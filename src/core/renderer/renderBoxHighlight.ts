import { BoundingBox } from "@core/types";

export default function renderBoxHighlight(
  ctx: CanvasRenderingContext2D,
  box: BoundingBox,
  scale: number,
) {
  ctx.save();

  ctx.lineWidth = 2 / scale;
  ctx.fillStyle = "rgba(255,0,0,0.2)";
  ctx.strokeStyle = "rgba(255,0,0,0.9)";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeRect(box.x, box.y, box.w, box.h);

  ctx.restore();
}
