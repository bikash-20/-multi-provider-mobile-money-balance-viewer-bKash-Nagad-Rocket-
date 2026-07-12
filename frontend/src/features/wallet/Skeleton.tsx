"use client";
/**
 * Skeleton — animated shimmer placeholder.
 *
 * Used while /api/entries is in flight on first mount. Renders a
 * shape (rounded rectangle, line, or block) with a subtle left→right
 * sheen via the `.skeleton-shimmer` keyframe in globals.css.
 *
 * Honours prefers-reduced-motion: the @media block in globals.css
 * disables the animation, so the placeholders render as a flat fill
 * (still readable, just static).
 */
interface SkeletonProps {
  className?: string;
  /** Used to give screen readers a hint about what's loading. */
  label?: string;
}

export function Skeleton({ className = "", label }: SkeletonProps) {
  return (
    <div
      role={label ? "status" : undefined}
      aria-label={label}
      aria-live="polite"
      className={`skeleton-shimmer rounded-md ${className}`}
    />
  );
}