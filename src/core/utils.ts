import { BoundingBox, Point, RotatedBoundingBox, XYCoords } from "./types";
import { PATH_JOIN_THRESHOLD } from "@constants";

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** returns a boolean indicating if the first and last
 * points of a path are close together */
export function isPathClosed(path: Point[]) {
  if (path.length < 3) return true;
  const [startX, startY] = path[0];
  const [endX, endY] = path[path.length - 1];

  return Math.hypot(endX - startX, endY - startY) <= PATH_JOIN_THRESHOLD;
}

/** Inverts a the width or height of a bounding box if they are negative and
 * returns which axes were inverted. (Note: Visually, position of bounding
 * box will not change) */
export function invertNegativeBoundingBox(box: BoundingBox): {
  box: BoundingBox;
  didFlipX: boolean;
  didFlipY: boolean;
} {
  let { x, y, w, h } = box;
  let didFlipX = false;
  let didFlipY = false;

  if (box.w < 0) {
    w *= -1;
    x -= w;
    didFlipX = true;
  }
  if (box.h < 0) {
    h *= -1;
    y -= h;
    didFlipY = true;
  }

  return { didFlipX, didFlipY, box: { x, y, w, h } };
}

export function rotatePointAroundAnchor(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  angle: number,
): XYCoords {
  return {
    x: Math.cos(angle) * (x1 - x2) - Math.sin(angle) * (y1 - y2) + x2,
    y: Math.sin(angle) * (x1 - x2) + Math.cos(angle) * (y1 - y2) + y2,
  };
}

/** returns the rotated coords of a bounding box in a clockwise direction
 * starting from the top-left */
export function getRotatedBoxCoords(box: RotatedBoundingBox): XYCoords[] {
  const x1 = box.x;
  const x2 = x1 + box.w;
  const y1 = box.y;
  const y2 = y1 + box.h;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  return [
    rotatePointAroundAnchor(x1, y1, cx, cy, box.rotate), // nw
    rotatePointAroundAnchor(x2, y1, cx, cy, box.rotate), // ne
    rotatePointAroundAnchor(x1, y2, cx, cy, box.rotate), // sw
    rotatePointAroundAnchor(x2, y2, cx, cy, box.rotate), // se
  ];
}

export function getSurroundingBoundingBox(
  boxes: RotatedBoundingBox[],
): RotatedBoundingBox {
  if (boxes.length < 1) return { x: 0, y: 0, w: 0, h: 0, rotate: 0 };
  if (boxes.length === 1) {
    // if there is a single box return its bounds
    const { x, y, w, h, rotate } = boxes[0];
    return { x, y, w, h, rotate };
  }
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;

  for (let i = 0; i < boxes.length; i += 1) {
    const [nw, ne, sw, se] = getRotatedBoxCoords(boxes[i]);

    x1 = Math.min(x1, nw.x, ne.x, se.x, sw.x);
    y1 = Math.min(y1, nw.y, ne.y, se.y, sw.y);
    x2 = Math.max(x2, nw.x, ne.x, se.x, sw.x);
    y2 = Math.max(y2, nw.y, ne.y, se.y, sw.y);
  }

  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, rotate: 0 };
}

export function deepClone<T extends object>(obj: T): T {
  const clone = (Array.isArray(obj) ? [] : {}) as T;

  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i] as keyof T;

    if (Object.hasOwn(obj, key)) {
      const value = obj[key];
      if (typeof value === "object") {
        clone[key] = deepClone(value as object) as T[keyof T];
      } else {
        clone[key] = value;
      }
    }
  }

  return clone;
}

export function assignWithoutUndefined<T extends object, S extends object>(
  target: T,
  source: S,
) {
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = source[key as keyof S];
    if (Object.hasOwn(source, key) && value !== undefined) {
      type kT = keyof T;
      // eslint-disable-next-line no-param-reassign
      target[key as kT] = value as T[kT];
    }
  }

  return target;
}
