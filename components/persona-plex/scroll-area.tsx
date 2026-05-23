// ScrollArea — hides native scrollbars and overlays a thin indicator bar that
// fades in on scroll/hover and out after idle, the way macOS/iOS treat long
// text and scroll views. Pure DOM math, no library. Ported from the design.

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";

interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  dark?: boolean;
  contentClassName?: string;
}

export function ScrollArea({
  children,
  className = "",
  dark = false,
  contentClassName = "",
  ...rest
}: ScrollAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const ind = indicatorRef.current;
    if (!el || !ind) return;

    let raf = 0;
    const update = () => {
      const visible = el.clientHeight;
      const total = el.scrollHeight;
      if (total <= visible + 1) {
        ind.style.opacity = "0";
        ind.style.height = "0";
        return;
      }
      const ratio = visible / total;
      const h = Math.max(28, visible * ratio - 8);
      const max = visible - h - 8;
      const top = (el.scrollTop / (total - visible)) * max + 4;
      ind.style.height = h + "px";
      ind.style.transform = `translateY(${top}px)`;
    };

    const flash = () => {
      setShow(true);
      if (hideRef.current) clearTimeout(hideRef.current);
      hideRef.current = setTimeout(() => setShow(false), 900);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
      flash();
    };
    const onEnter = () => {
      update();
      flash();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("touchstart", flash, { passive: true });
    el.addEventListener("wheel", flash, { passive: true });

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true, characterData: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("touchstart", flash);
      el.removeEventListener("wheel", flash);
      ro.disconnect();
      mo.disconnect();
      if (hideRef.current) clearTimeout(hideRef.current);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className={`pp-scroll-wrap ${className}`} {...rest}>
      <div className={`pp-scroll-area ${contentClassName}`} ref={scrollRef}>
        {children}
      </div>
      <div
        className={`pp-scroll-indicator ${show ? "on" : ""} ${dark ? "dark" : ""}`}
        ref={indicatorRef}
      />
    </div>
  );
}
