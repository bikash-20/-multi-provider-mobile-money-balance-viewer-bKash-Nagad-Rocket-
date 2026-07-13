/**
 * RecentEntries — unit tests for the Phase 11 auto-load predicate.
 *
 * The DOM-rendering path (useAutoLoadOnIntersect → IntersectionObserver
 * → callback) is covered end-to-end by integration; here we just pin
 * the pure predicate that decides whether to fire onLoadOlder on an
 * intersection event. The predicate is the only piece of behaviour
 * that can vary without a real DOM, so testing it here keeps the
 * suite honest without pulling in jsdom + @testing-library/react.
 */
import { describe, it, expect } from "vitest";

import { shouldAutoLoad } from "../RecentEntries";

describe("RecentEntries — shouldAutoLoad", () => {
  it("returns true when at least one entry is intersecting and not loading", () => {
    expect(
      shouldAutoLoad([{ isIntersecting: true }], false),
    ).toBe(true);
  });

  it("returns true when the second entry is the intersecting one", () => {
    // The observer may batch multiple entries per tick; we accept any
    // hit, not just the first.
    expect(
      shouldAutoLoad(
        [{ isIntersecting: false }, { isIntersecting: true }],
        false,
      ),
    ).toBe(true);
  });

  it("returns false when no entry is intersecting", () => {
    expect(
      shouldAutoLoad(
        [{ isIntersecting: false }, { isIntersecting: false }],
        false,
      ),
    ).toBe(false);
  });

  it("returns false on an empty entries list (no observer events yet)", () => {
    expect(shouldAutoLoad([], false)).toBe(false);
  });

  it("returns false while a load is already in flight, even if intersecting", () => {
    expect(
      shouldAutoLoad([{ isIntersecting: true }], true),
    ).toBe(false);
  });

  it("treats undefined loadingOlder as 'not loading' (matches useState initial)", () => {
    // The page never passes undefined here in practice, but the
    // predicate should still behave correctly if a caller does —
    // keeps the function total.
    expect(
      shouldAutoLoad([{ isIntersecting: true }], undefined),
    ).toBe(true);
  });
});
