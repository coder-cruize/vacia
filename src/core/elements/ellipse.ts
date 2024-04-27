import * as GenericBoxUtils from "./genericBox";
import { ElementHandler } from "./handler";
import { EllipseElement } from "./types";
import { GENERIC_ELEMENT_PROPS } from "@constants";
import { CanvasPointer } from "@core/pointer";
import { BoundingBox, XYCoords } from "@core/types";
import { rotatePoint } from "@core/utils";

export class EllipseHandler extends ElementHandler<EllipseElement> {
  create(box: BoundingBox): EllipseElement {
    return {
      ...GENERIC_ELEMENT_PROPS,
      ...box,
      type: "ellipse",
    };
  }

  hitTest(element: EllipseElement, coords: XYCoords) {
    const { x, y, w, h, rotate } = element;
    const rX = w / 2;
    const rY = h / 2;
    const cX = x + w / 2;
    const cY = y + h / 2;

    const rotatedCoords = rotatePoint(coords.x, coords.y, cX, cY, -rotate);
    const value =
      (rotatedCoords.x - cX) ** 2 / rX ** 2 +
      (rotatedCoords.y - cY) ** 2 / rY ** 2;

    return value <= 1;
  }

  render(element: EllipseElement, ctx: CanvasRenderingContext2D) {
    const { x, y, w, h, rotate, fill } = element;

    const rX = w / 2;
    const rY = h / 2;

    ctx.translate(x + rX, y + rY);
    ctx.rotate(rotate);

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, rX, rY, 0, 0, 2 * Math.PI, false);
    ctx.fill();
  }

  onCreateDrag(elem: EllipseElement, pointer: CanvasPointer, e: PointerEvent) {
    const state = this.app.state();
    const mutations = GenericBoxUtils.handleCreateDrag(elem, pointer, e, state);
    this.app.elementLayer().mutateElement(elem, mutations);
  }
}