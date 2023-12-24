import React from "react";
import DesignMenu from "@components/DesignMenu";
import QuickActions from "@components/QuickActions";
import ToolBar from "@components/ToolBar";
import { ELEMENT_PRECISION, ZOOM_STEP } from "@constants";
import { createAppState, createPointerState } from "@core/createState";
import ElementLayer, { ElementLayerChangeEvent } from "@core/elementLayer";
import { createFreedrawElement, createShapeElement } from "@core/elements";
import { isElementNegligible } from "@core/elements/negligible";
import {
  getTransformHandles,
  getSelectionTransformData,
  getTransformedElementMutations,
  rescalePath,
} from "@core/elements/transform";
import {
  hitTestElementAgainstUnrotatedBox,
  hitTestCoordsAgainstUnrotatedBox,
  hitTestCoordsAgainstElement,
  hitTestCoordsAgainstTransformHandles,
} from "@core/hitTest";
import renderFrame from "@core/renderer";
import {
  AppState,
  CanvasElement,
  PointerState,
  BoundingBox,
  ToolLabel,
  XYCoords,
  CanvasElementMutations,
  TransformingElement,
  TransformHandle,
} from "@core/types";
import {
  getSurroundingBoundingBox,
  invertNegativeBoundingBox,
} from "@core/utils";
import {
  getScreenCenterCoords,
  getNewZoomState,
  snapVirtualCoordsToGrid,
  screenOffsetToVirtualOffset,
} from "@core/viewport";
import "@css/App.scss";

declare global {
  interface Window {
    appData: {
      state: AppState;
      setState: (state: Partial<AppState>) => void;
      pointer: PointerState | null;
    };
  }
}

class App extends React.Component<Record<string, never>, AppState> {
  canvas: HTMLCanvasElement | null = null;
  pointer: PointerState | null = null;
  elementLayer = new ElementLayer(this.onElementLayerUpdate.bind(this));

  constructor(props: Record<string, never>) {
    super(props);
    this.state = createAppState();
    if (import.meta.env.DEV) {
      window.appData = {} as Window["appData"];
      Object.defineProperties(window.appData, {
        state: {
          configurable: true,
          get: () => this.state,
        },
        setState: {
          configurable: true,
          value: (...args: Parameters<typeof this.setState>) => {
            this.setState(...args);
          },
        },
        pointer: {
          configurable: true,
          get: () => this.pointer,
        },
      });
    }
  }

  private getFirstElementAtCoords(coords: XYCoords) {
    const allElements = this.elementLayer.getAllElements();
    let hitElement: CanvasElement | null = null;

    for (let i = allElements.length - 1; i > -1; i -= 1) {
      const element = allElements[i];

      if (hitTestCoordsAgainstElement(element, coords)) {
        hitElement = element;
        break;
      }
    }
    return hitElement;
  }

  private getAllElementsWithinBox(box: BoundingBox) {
    const allElements = this.elementLayer.getAllElements();
    const hitElements: CanvasElement[] = [];

    for (let i = 0; i < allElements.length; i += 1) {
      const element = allElements[i];

      if (hitTestElementAgainstUnrotatedBox(element, box)) {
        hitElements.push(element);
      }
    }

    return hitElements;
  }

  private createElementFromTool(
    tool: ToolLabel,
    position: XYCoords,
    snapElementToGrid: boolean,
  ) {
    let element: CanvasElement | null = null;
    const elementPosition = snapElementToGrid
      ? position
      : snapVirtualCoordsToGrid(position, this.state);
    const box = { ...elementPosition, w: 0, h: 0 };
    switch (tool) {
      case "Ellipse":
        element = createShapeElement({ shape: "ellipse", ...box });
        break;
      case "Rectangle":
        element = createShapeElement({ shape: "rect", ...box });
        break;
      case "Freedraw":
        element = createFreedrawElement({
          path: [[0, 0]],
          // freedraw should not be snapped to use original position
          ...position,
          w: 0,
          h: 0,
        });
        break;
      default:
    }

    return element;
  }

  // setup functions
  private setCanvasRef = (canvas: HTMLCanvasElement) => {
    if (canvas) {
      this.canvas = canvas;
    }
  };

  // local event handlers
  private onToolChange = (tool: ToolLabel) => {
    this.setState({ activeTool: tool });
  };

  private onElementLayerUpdate(e: ElementLayerChangeEvent) {
    this.setState({});
  }

  private onDesignMenuUpdate = (
    elements: CanvasElement[],
    mutations: CanvasElementMutations,
  ) => {
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements[i];
      if (element.type === "freedraw") {
        let scaleX = (mutations.w ?? element.w) / element.w;
        let scaleY = (mutations.h ?? element.h) / element.h;

        if (!Number.isFinite(scaleX)) scaleX = 1;
        if (!Number.isFinite(scaleY)) scaleY = 1;
        if (scaleX !== 1 || scaleY !== 1) {
          // eslint-disable-next-line no-param-reassign
          mutations.path = rescalePath(element.path, scaleX, scaleY, 0, 0);
        }
      }
      this.elementLayer.mutateElement(element, mutations);
    }
  };

  private onElementDrag(
    e: PointerEvent,
    pointer: PointerState,
    elements: CanvasElement[],
  ) {
    const offset = screenOffsetToVirtualOffset(pointer.drag.offset, this.state);
    const previousOffset = screenOffsetToVirtualOffset(
      pointer.drag.previousOffset,
      this.state,
    );
    const dragChange = {
      x: offset.x - previousOffset.x,
      y: offset.y - previousOffset.y,
    };

    if (!e.ctrlKey) {
      const currentDragOffsetSnapped = snapVirtualCoordsToGrid(
        offset,
        this.state,
      );
      const previousDragOffsetSnapped = snapVirtualCoordsToGrid(
        previousOffset,
        this.state,
      );

      /** pointerDragChange may be less than snapping threshold, so for
       * snapping to work properly, snap the current and previous drag offsets
       * individually before getting their difference */
      Object.assign(dragChange, {
        x: currentDragOffsetSnapped.x - previousDragOffsetSnapped.x,
        y: currentDragOffsetSnapped.y - previousDragOffsetSnapped.y,
      });
    }

    /** if there are elements being dragged update their {x, y} coords  */
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements[i];
      const newElementPosition = {
        x: element.x + dragChange.x,
        y: element.y + dragChange.y,
      };
      if (!e.ctrlKey) {
        Object.assign(
          newElementPosition,
          snapVirtualCoordsToGrid(newElementPosition, this.state),
        );
      }
      /** only mutate element if coords changes (to reduce rerenders). */
      if (
        newElementPosition.x !== element.x ||
        newElementPosition.y !== element.y
      ) {
        this.elementLayer.mutateElement(element, newElementPosition);
      }
    }
  }

  private onElementTransform(
    e: PointerEvent,
    pointer: PointerState,
    handle: TransformHandle,
    elements: TransformingElement[],
  ) {
    /** initial selection box of all elements being transformed */
    const selectionBox = getSurroundingBoundingBox(
      elements.map(({ initialElement }) => initialElement),
    );
    const pointerPosition = screenOffsetToVirtualOffset(
      {
        x: pointer.origin.x + pointer.drag.offset.x,
        y: pointer.origin.y + pointer.drag.offset.y,
      },
      this.state,
    );
    if (!e.ctrlKey) {
      Object.assign(
        pointerPosition,
        snapVirtualCoordsToGrid(pointerPosition, this.state),
      );
    }
    const transformData = getSelectionTransformData(
      pointerPosition,
      handle,
      selectionBox,
      // lock aspect ratio when there is more than one element
      elements.length > 1,
      !e.ctrlKey,
    );

    elements.forEach((transformingElement) => {
      this.elementLayer.mutateElement(
        transformingElement.element,
        getTransformedElementMutations(transformingElement, transformData),
      );
    });
  }

  private onElementCreation(
    e: PointerEvent,
    pointer: PointerState,
    element: CanvasElement,
  ) {
    switch (element.type) {
      case "shape": {
        const elementBox = {
          ...screenOffsetToVirtualOffset(pointer.origin, this.state),
          w: pointer.drag.offset.x / this.state.zoom,
          h: pointer.drag.offset.y / this.state.zoom,
        };

        // when the position should be snapped
        if (!pointer.ctrlKey) {
          const position = snapVirtualCoordsToGrid(elementBox, this.state);
          Object.assign(elementBox, position);
        }

        // when the size should be snapped
        if (!e.ctrlKey) {
          const fallbackSize = this.state.grid.size;
          // absolute position of the w and h coords
          const sizeCoords = snapVirtualCoordsToGrid(
            { x: elementBox.x + elementBox.w, y: elementBox.y + elementBox.h },
            this.state,
          );

          // use calculated size or fallback to prevent 0 values
          elementBox.w = sizeCoords.x - elementBox.x || fallbackSize;
          elementBox.h = sizeCoords.y - elementBox.y || fallbackSize;
        }

        /** box created from pointer origin to its current position */
        const normalizedBox = invertNegativeBoundingBox(elementBox);
        this.elementLayer.mutateElement(element, {
          ...normalizedBox.box,
          flippedX: normalizedBox.didFlipX,
          flippedY: normalizedBox.didFlipY,
        });
        break;
      }

      case "freedraw": {
        const point = screenOffsetToVirtualOffset(
          {
            x: pointer.origin.x + pointer.drag.offset.x,
            y: pointer.origin.y + pointer.drag.offset.y,
          },
          this.state,
        );

        const mutations = {
          x: element.x,
          y: element.y,
          w: element.w,
          h: element.h,
          // reuse `path` sice it will be destroyed
          path: element.path,
        };

        const dx = Math.max(mutations.x - point.x, 0);
        const dy = Math.max(mutations.y - point.y, 0);

        mutations.x -= dx;
        mutations.y -= dy;
        mutations.w = Math.max(mutations.w, point.x - mutations.x) + dx;
        mutations.h = Math.max(mutations.h, point.y - mutations.y) + dy;
        mutations.path.push([
          /** subtract x, y coords to make point relative to element position
           * then set precision */
          +(point.x - mutations.x).toFixed(ELEMENT_PRECISION),
          +(point.y - mutations.y).toFixed(ELEMENT_PRECISION),
        ]);

        /** apply changes on the x or y coords to path points */
        if (dx || dy) {
          mutations.path.forEach((pathPoint) => {
            // eslint-disable-next-line no-param-reassign
            pathPoint[0] = +(pathPoint[0] + dx).toFixed(2);
            // eslint-disable-next-line no-param-reassign
            pathPoint[1] = +(pathPoint[1] + dy).toFixed(2);
          });
        }
        // apply mutations
        this.elementLayer.mutateElement(element, mutations);
        break;
      }

      default:
        break;
    }
  }

  // event handling
  private addEventListeners = () => {
    window.addEventListener("pointermove", this.onWindowPointerMove);
    window.addEventListener("pointerup", this.onWindowPointerUp);
    window.addEventListener("wheel", this.onWindowWheel, { passive: false });
  };

  private onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.buttons === 1) {
      this.pointer = createPointerState(e.nativeEvent);
      /** pointer coords in virtual space */
      const virtualPointerCoords = screenOffsetToVirtualOffset(
        this.pointer.origin,
        this.state,
      );

      if (this.state.activeTool === "Selection") {
        const selectedElements = this.elementLayer.getSelectedElements();
        const selectionBox = getSurroundingBoundingBox(selectedElements);
        const transformHandles = getTransformHandles(
          selectionBox,
          this.state.zoom,
        );
        const hitHandle = hitTestCoordsAgainstTransformHandles(
          transformHandles,
          virtualPointerCoords,
          this.state,
        );
        const isPointerInSelectionBox = hitTestCoordsAgainstUnrotatedBox(
          virtualPointerCoords,
          selectionBox,
        );

        if (hitHandle) {
          this.elementLayer.setTransformingElements(selectedElements);
          this.pointer.hit.transformHandle = hitHandle;
        } else if (isPointerInSelectionBox) {
          this.elementLayer.setDraggingElements(selectedElements);
        } else {
          const element = this.getFirstElementAtCoords(virtualPointerCoords);

          if (!this.pointer.shiftKey) this.elementLayer.unselectAllElements();
          if (element) {
            this.pointer.hit.element = element;
            this.elementLayer.selectElements([element]);
            this.elementLayer.setDraggingElements(
              // Selection changed, so use the latest selected elements.
              this.elementLayer.getSelectedElements(),
            );
          }
        }
      } else {
        const element = this.createElementFromTool(
          this.state.activeTool,
          virtualPointerCoords,
          this.pointer.ctrlKey,
        );
        if (element) this.elementLayer.addCreatingElement(element);
      }
    }
  };

  private onWindowWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) {
      const direction = -Math.sign(e.deltaY);
      const value = this.state.zoom + direction * ZOOM_STEP;
      const zoomState = getNewZoomState(value, e, this.state);

      this.setState(zoomState);
    }
  };

  private onWindowPointerUp = (e: PointerEvent) => {
    if (!this.pointer) return;

    const elementBeingCreated = this.elementLayer.getCreatingElement();
    const draggableElementsExist =
      this.state.activeTool === "Selection" &&
      this.elementLayer.getDraggingElements().length > 1;
    const shouldDeleteElement =
      elementBeingCreated &&
      isElementNegligible(elementBeingCreated, this.state);

    if (!this.pointer.drag.occurred && draggableElementsExist) {
      if (!this.pointer.shiftKey) {
        this.elementLayer.unselectAllElements();
      }

      if (this.pointer.hit.element) {
        this.elementLayer.selectElements([this.pointer.hit.element]);
      }
    }

    if (shouldDeleteElement) {
      this.elementLayer.deleteElement(elementBeingCreated);
    }

    this.elementLayer.clearCreatingElement();
    this.elementLayer.clearDraggingElements();
    this.elementLayer.clearTransformingElements();
    this.pointer = null;

    if (this.state.activeTool === "Selection") {
      this.setState({ selectionHighlight: null });
    }
  };

  private onWindowPointerMove = (e: PointerEvent) => {
    if (!this.pointer) return;

    /** if pointer exists update its drag and previousDrag */
    this.pointer.drag = {
      occurred: true,
      previousOffset: this.pointer.drag.offset,
      offset: {
        x: e.clientX - this.pointer.origin.x,
        y: e.clientY - this.pointer.origin.y,
      },
    };

    if (this.state.activeTool === "Hand") {
      const pointerDragChange = {
        x: this.pointer.drag.offset.x - this.pointer.drag.previousOffset.x,
        y: this.pointer.drag.offset.y - this.pointer.drag.previousOffset.y,
      };

      this.setState({
        scrollOffset: {
          x: this.state.scrollOffset.x + pointerDragChange.x,
          y: this.state.scrollOffset.y + pointerDragChange.y,
        },
      });
      return;
    }

    if (this.state.activeTool === "Selection") {
      const draggingElements = this.elementLayer.getDraggingElements();
      const transformingElements = this.elementLayer.getTransformingElements();

      if (this.pointer.hit.transformHandle) {
        this.onElementTransform(
          e,
          this.pointer,
          this.pointer.hit.transformHandle,
          transformingElements,
        );
      } else if (draggingElements.length) {
        this.onElementDrag(e, this.pointer, draggingElements);
      } else {
        /** pointer drag is treated as a box selection */
        const { box: selectionBox } = invertNegativeBoundingBox({
          ...screenOffsetToVirtualOffset(this.pointer.origin, this.state),
          w: this.pointer.drag.offset.x / this.state.zoom,
          h: this.pointer.drag.offset.y / this.state.zoom,
        });

        this.setState({ selectionHighlight: selectionBox });
        this.elementLayer.selectElements(
          this.getAllElementsWithinBox(selectionBox),
        );
      }
    }

    const elementBeingCreated = this.elementLayer.getCreatingElement();

    if (elementBeingCreated) {
      this.onElementCreation(e, this.pointer, elementBeingCreated);
    }
  };

  // react lifecycle
  componentDidMount() {
    this.addEventListeners();
    this.setState({});
  }

  componentDidUpdate() {
    renderFrame({
      canvas: this.canvas!,
      state: this.state,
      scale: window.devicePixelRatio,
      elements: this.elementLayer.getAllElements(),
      selectedElements: this.elementLayer.getSelectedElements(),
    });
  }

  // rendering
  render() {
    const canvasWidth = this.state.width;
    const canvasHeight = this.state.height;
    const canvasVirtualWidth = canvasWidth * window.devicePixelRatio;
    const canvasVirtualHeight = canvasHeight * window.devicePixelRatio;

    const handleZoomInAction = () => {
      const zoomState = getNewZoomState(
        this.state.zoom + ZOOM_STEP,
        getScreenCenterCoords(this.state),
        this.state,
      );

      this.setState(zoomState);
    };
    const handleZoomOutAction = () => {
      const zoomState = getNewZoomState(
        this.state.zoom - ZOOM_STEP,
        getScreenCenterCoords(this.state),
        this.state,
      );

      this.setState(zoomState);
    };

    const selectedElements = this.elementLayer.getSelectedElements();

    return (
      <div className="app">
        {!!selectedElements.length && (
          <DesignMenu
            selectedElements={selectedElements}
            toolbarPosition={this.state.toolbarPosition}
            onChange={this.onDesignMenuUpdate}
          />
        )}
        <div className="tools">
          <ToolBar
            position={this.state.toolbarPosition}
            activeTool={this.state.activeTool}
            onToolChange={this.onToolChange}
          />
          <QuickActions
            onZoomIn={handleZoomInAction}
            onZoomOut={handleZoomOutAction}
          />
        </div>
        <canvas
          data-testid="app-canvas"
          width={canvasVirtualWidth}
          height={canvasVirtualHeight}
          style={{ width: canvasWidth, height: canvasHeight }}
          ref={this.setCanvasRef}
          onPointerDown={this.onCanvasPointerDown}
        />
      </div>
    );
  }
}
export default App;
