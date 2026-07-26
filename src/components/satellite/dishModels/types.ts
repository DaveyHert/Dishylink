// The shape every baked dish model has, and the only thing the renderer needs to
// know about them.
//
// This lived in rev4Standard.ts because that model was written first, which left
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
  /**
   * Hold the camera outside this model's own radius.
   *
   * Only for a body with an interior to fall into. A panel on a mast can be
   * taller than the camera's closest orbit and still needs nothing — it has no
   * inside, so the eye passes it rather than entering it. An aircraft does: once
   * the eye is within the hull the near wall clips away and the viewer is left
   * looking at the far wall from inside.
   *
   * Opt-in rather than derived from size, because size does not distinguish the
   * two cases: rev2Circular's radius exceeds the floor and it is perfectly fine.
   */
  keepCameraOutside?: boolean;
  /**
   * Where the beam leaves the panel, in millimetres in the model's own frame.
   * Defaults to 14mm along the boresight, which is just clear of the face on a
   * model that IS a panel. A model carrying its dish somewhere other than the
   * origin — an aircraft with a terminal on its crown — has to say so, or the
   * beam starts inside the body.
   */
  beamOriginMm?: [number, number, number];
}
