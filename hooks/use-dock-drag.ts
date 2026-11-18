"use client";

// Drag-to-dock for the floating Tweaks button.
//
// The button follows the pointer through two CSS variables (--tb-drag-x/y, a
// translate offset from its docked spot) and, on release, snaps to the nearest
// dock. Dock geometry lives only in CSS: the snap targets are real elements
// with the same dock classes as the button, so their rects are the anchors.
// A press that moves less than DRAG_THRESHOLD_PX stays a click.

import { useCallback, useRef, useState, type PointerEvent } from "react";
import { TWEAKS_DOCKS, nearestDock, type DockAnchors, type TweaksDock } from "@/lib/tweaks-dock";

const DRAG_THRESHOLD_PX = 5;

interface Press {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
}

export interface DockDrag {
  /** The dock the button would snap to if dropped now; null when not dragging. */
  hover: TweaksDock | null;
  /** Ref callback for each dock's snap-target element. */
  targetRef: (dock: TweaksDock) => (el: HTMLElement | null) => void;
  handlers: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  };
  /** True (once) when the click that follows a drag must be ignored. */
  consumeDragClick: () => boolean;
}

function center(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function resetOffset(el: HTMLElement) {
  el.style.removeProperty("--tb-drag-x");
  el.style.removeProperty("--tb-drag-y");
}

export function useDockDrag(onDock: (dock: TweaksDock) => void): DockDrag {
  const [hover, setHover] = useState<TweaksDock | null>(null);
  const targets = useRef<Partial<Record<TweaksDock, HTMLElement | null>>>({});
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);

  const targetRef = useCallback(
    (dock: TweaksDock) => (el: HTMLElement | null) => {
      targets.current[dock] = el;
    },
    [],
  );

  // Measured on every move, so a resize mid-drag (or the mobile layout) is honored.
  const nearestTo = useCallback((el: Element): TweaksDock | null => {
    const anchors = {} as DockAnchors;
    for (const dock of TWEAKS_DOCKS) {
      const target = targets.current[dock];
      if (!target) return null;
      anchors[dock] = center(target);
    }
    return nearestDock(center(el), anchors);
  }, []);

  const end = useCallback((el: HTMLElement) => {
    press.current = null;
    resetOffset(el);
    setHover(null);
  }, []);

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    press.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      p.moved = true;
      const el = e.currentTarget;
      el.style.setProperty("--tb-drag-x", `${dx}px`);
      el.style.setProperty("--tb-drag-y", `${dy}px`);
      setHover(nearestTo(el));
    },
    [nearestTo],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      if (p.moved) {
        const dock = nearestTo(e.currentTarget);
        suppressClick.current = true;
        if (dock) onDock(dock);
      }
      end(e.currentTarget);
    },
    [end, nearestTo, onDock],
  );

  const onPointerCancel = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (press.current?.pointerId === e.pointerId) end(e.currentTarget);
    },
    [end],
  );

  const consumeDragClick = useCallback(() => {
    const suppressed = suppressClick.current;
    suppressClick.current = false;
    return suppressed;
  }, []);

  return {
    hover,
    targetRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    consumeDragClick,
  };
}
