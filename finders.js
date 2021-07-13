import { Vector, asPnt, createNamedPlane } from "./geom.js";
import { registerObj, unregisterObj } from "./register.js"
import { DEG2RAD } from "./constants.js";

export const edgeIsParallelTo = (oc, edge, parallelTo = [0, 0, 1]) => {
  const { startPoint, endPoint } = edge;
  const v = new Vector(oc, parallelTo);
  const direction = endPoint.sub(startPoint).normalize();
  const dotProduct = direction.dot(v);

  startPoint.delete();
  endPoint.delete();
  v.delete();
  direction.delete();

  return Math.abs(dotProduct - 1) < 1e-6;
};

export const findInList = (edgesList, value) => {
  return (edge) => {
    const found = edgesList.find((e) => e.isSame(edge));
    if (found) return value;
    return null;
  };
};

export const max = (array, maxFcn) => {
  return array
    .map((elem) => ({ value: maxFcn(elem), elem }))
    .reduce((a, b) => {
      if (!a) return b;
      if (!b) return a;

      if (a.value >= b.value) return a;
      return b;
    }, null).elem;
};

export const min = (array, minFcn) => {
  return array
    .map((elem) => ({ value: minFcn(elem), elem }))
    .reduce((a, b) => {
      if (!a) return b;
      if (!b) return a;

      if (a.value <= b.value) return a;
      return b;
    }, null).elem;
};

const DIRECTIONS = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
};
const PLANE_TO_DIR = {
  YZ: [1, 0, 0],
  XZ: [0, 1, 0],
  XY: [0, 0, 1],
};

class Finder {
  constructor(oc) {
    this.oc = oc;
    this.filters = [];
    this.references = [];
    registerObj(this)
  }

  delete() {
    this.references.forEach((r) => r.delete());
    this.references = [];
    this.filters = [];
    unregisterObj(this)
  }

  atAngleWith(direction = "Z", angle = 0) {
    let myDirection;
    if (DIRECTIONS[direction]) {
      myDirection = new Vector(this.oc, DIRECTIONS[direction]);
    } else {
      myDirection = new Vector(this.oc, direction);
    }

    const checkAngle = ({ normal }) => {
      // We do not care about the orientation
      const angleOfNormal = Math.acos(Math.abs(normal.dot(myDirection)));
      //console.log("angle", angleOfNormal / DEG2RAD);

      return Math.abs(angleOfNormal - DEG2RAD * angle) < 1e-6;
    };

    this.filters.push(checkAngle);
    this.references.push(myDirection);

    return this;
  }

  containsPoint(point) {
    const pnt = asPnt(this.oc, point);

    const vertexMaker = new this.oc.BRepBuilderAPI_MakeVertex(pnt);
    const vertex = vertexMaker.Vertex();
    vertexMaker.delete();

    const distanceBuilder = new this.oc.BRepExtrema_DistShapeShape_1();
    distanceBuilder.LoadS1(vertex);

    const checkPoint = ({ element }) => {
      distanceBuilder.LoadS2(element.wrapped);
      distanceBuilder.Perform();

      //console.log("distance", distanceBuilder.Value());
      return distanceBuilder.Value() < 1e-6;
    };

    this.filters.push(checkPoint);
    this.references.push(distanceBuilder);

    return this;
  }

  find(shape, { unique = false, clean = false } = {}) {
    let elements = this.applyFilter(shape);

    if (unique) {
      if (elements.length !== 1) {
        console.error(elements);
        throw new Error("Finder has not found a unique solution");
      }
      elements = elements[0];
    }

    if (clean) this.delete();
    return elements;
  }

  either(findersList) {
    const builtFinders = findersList.map((finderFunction) => {
      const finder = new this.constructor(this.oc);
      this.references.push(finder);
      finderFunction(finder);
      return finder;
    });

    const eitherFilter = ({ element }) =>
      builtFinders.some((finder) => finder.shouldKeep(element));
    this.filters.push(eitherFilter);

    return this;
  }

  asSizeFcn(size) {
    return (element) => {
      const shouldKeep = this.shouldKeep(element);
      return shouldKeep ? size : 0;
    };
  }
}

export class FaceFinder extends Finder {
  parallelTo(plane) {
    if (PLANE_TO_DIR[plane]) return this.atAngleWith(PLANE_TO_DIR[plane]);
    if (plane.zDir) return this.atAngleWith(plane.zDir);
    if (plane.normalAt) {
      const normal = plane.normalAt();
      this.atAngleWith(normal);
      normal.delete();
      return this;
    }
  }

  shouldKeep(element) {
    const normal = element.normalAt();
    const shouldKeep = this.filters.every((filter) =>
      filter({ normal, element })
    );
    normal.delete();
    return shouldKeep;
  }

  applyFilter(shape) {
    return shape.faces.filter((face) => {
      const shouldKeep = this.shouldKeep(face);
      if (!shouldKeep) face.delete();
      return shouldKeep;
    });
  }
}

export class EdgeFinder extends Finder {
  parallelTo(plane) {
    if (PLANE_TO_DIR[plane]) return this.atAngleWith(PLANE_TO_DIR[plane], 90);
    if (plane.zDir) return this.atAngleWith(plane.zDir, 90);
    if (plane.normalAt) {
      const normal = plane.normalAt();
      this.atAngleWith(normal, 90);
      normal.delete();
      return this;
    }
  }

  inPlane(inputPlane) {
    let plane = inputPlane;
    if (typeof inputPlane === "string") {
      plane = createNamedPlane(this.oc, plane);
      this.references.push(plane);
    }

    this.parallelTo(plane);

    const firstPointInPlane = ({ element }) => {
      const point = element.startPoint;
      const projectedPoint = point.projectToPlane(plane);

      const isSamePoint = point.equals(projectedPoint);
      point.delete();
      projectedPoint.delete();

      return isSamePoint;
    };

    this.filters.push(firstPointInPlane);
    return this;
  }

  shouldKeep(element) {
    const normal = element.tangentAt();
    const shouldKeep = this.filters.every((filter) =>
      filter({ normal, element })
    );
    normal.delete();
    return shouldKeep;
  }

  applyFilter(shape) {
    return shape.edges.filter((edge) => {
      const shouldKeep = this.shouldKeep(edge);
      if (!shouldKeep) edge.delete();
      return shouldKeep;
    });
  }
}
