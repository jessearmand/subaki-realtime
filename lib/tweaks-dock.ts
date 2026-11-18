// Where the floating Tweaks button (and its panel) docks.
//
// Three fixed spots, so the button never ends up half off-screen or parked over
// arbitrary content: the viewport's bottom-right and top-right corners, and the
// bottom of the left sidebar (bottom-left of the viewport when there is no
// sidebar, e.g. the mobile drawer layout).

export type TweaksDock = "bottom-right" | "top-right" | "sidebar";

export const TWEAKS_DOCKS: TweaksDock[] = ["bottom-right", "top-right", "sidebar"];

export function isTweaksDock(value: unknown): value is TweaksDock {
  return typeof value === "string" && (TWEAKS_DOCKS as string[]).includes(value);
}

export interface Point {
  x: number;
  y: number;
}

/** The center of each dock's button, in viewport coordinates. */
export type DockAnchors = Record<TweaksDock, Point>;

/** The dock whose anchor is closest to where the button was dropped. */
export function nearestDock(drop: Point, anchors: DockAnchors): TweaksDock {
  let best: TweaksDock = TWEAKS_DOCKS[0];
  let bestDist = Infinity;
  for (const dock of TWEAKS_DOCKS) {
    const { x, y } = anchors[dock];
    const dist = Math.hypot(drop.x - x, drop.y - y);
    if (dist < bestDist) {
      best = dock;
      bestDist = dist;
    }
  }
  return best;
}
