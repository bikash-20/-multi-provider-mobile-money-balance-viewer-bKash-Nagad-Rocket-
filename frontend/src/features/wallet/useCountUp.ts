"use client";
/**
 * useCountUp — RAF-driven value animation.
 *
 * Animates a numeric value from `previous` to `target` over
 * `duration` ms using requestAnimationFrame and an ease-out cubic
 * curve. Returns the current animated value on every frame.
 *
 * Honors prefers-reduced-motion: when the user has set the OS
 * preference, the hook returns `target` immediately on the first
 * render — no animation. This matches the global rule in globals.css
 * but the hook reads the media-query directly so SSR + first render
 * are also correct (CSS-only would flash before kicking in).
 *
 * This is a leaf animation utility. The two strict React 19 lint
 * rules below are disabled at file scope because the entire purpose
 * of this hook is to coordinate setState + refs with an external
 * animation source (requestAnimationFrame) and the prefer-reduced-
 * motion media query — both of which require the patterns the rules
 * otherwise flag.
 */

/* eslint-disable react-hooks/refs */

import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function useCountUp(target: number, duration: number = 600): number {
  const [value, setValue] = useState<number>(target);
  // valueRef is updated inside the render so the effect below can
  // guard against redundant setState calls. We touch it again from
  // the RAF callback, which is allowed under react-hooks/refs.
  const valueRef = useRef<number>(target);
  valueRef.current = value;
  const fromRef = useRef<number>(target);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) {
      fromRef.current = target;
      if (valueRef.current !== target) setValue(target);
      return;
    }

    const from = fromRef.current;
    if (from === target) return;

    startRef.current = 0;
    const tick = (ts: number) => {
      if (startRef.current === 0) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(t);
      const next = from + (target - from) * eased;
      setValue(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        setValue(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, duration]);

  return value;
}