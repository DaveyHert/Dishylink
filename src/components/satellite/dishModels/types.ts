// The shape every baked dish model has, and the only thing the renderer needs to
// know about them.
//
// This lived in standard4.ts because that model was written first, which left
// every sibling — and buildDish itself — importing a type from one particular
// dish's data file. That made a generated file the contract for all the others:
// regenerating it could break them, and deleting it would break them for no
// reason at all. The contract belongs on its own.

export interface DishModelMesh {
  /** Divisor taking the stored ints back to millimetres. */
  scale: number;
  /** [firstTriangle, triangleCount, tint] per solid, drawn in order. */
  parts: Array<[number, number, number]>;
  /** base64 Int16Array, xyz per vertex. */
  positions: string;
  /** base64 Uint16Array, three per triangle. */
  indices: string;
  /** Panel long axis in millimetres, used to scale the model into the scene. */
  longAxisMm: number;
  /**
   * Motorised mounts only. Without it the model is a rigid body that leans as a
   * whole — right for the kickstand dishes, which is how they actually sit.
   * With it the model hinges: vertices from `baseVertex` on are the foot, which
   * stays flat on the ground and only turns in azimuth, and everything before it
   * is the head, which tilts to the boresight. Both meet at `pivot`, in the same
   * stored units as `positions`.
   */
  joint?: { baseVertex: number; pivot: [number, number, number] };
}
