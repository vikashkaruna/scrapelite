import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { dwellMs, useAutoDismissBanner, MIN_DWELL_MS, MAX_DWELL_MS, LEAVE_MS } from "./useAutoDismissBanner.js";

beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe("dwellMs", () => {
  it("scales with copy length but stays within the clamp", () => {
    expect(dwellMs(0)).toBe(MIN_DWELL_MS);
    expect(dwellMs(150)).toBeGreaterThan(dwellMs(60));
    expect(dwellMs(100_000)).toBe(MAX_DWELL_MS);
    expect(dwellMs(NaN)).toBe(MIN_DWELL_MS);
  });
});

describe("useAutoDismissBanner", () => {
  it("shown → leaving → gone after the reading time, and remembers for the session", () => {
    const { result } = renderHook(() => useAutoDismissBanner("t", { active: true, textLength: 100 }));
    expect(result.current.phase).toBe("shown");
    act(() => { vi.advanceTimersByTime(dwellMs(100)); });
    expect(result.current.phase).toBe("leaving");
    act(() => { vi.advanceTimersByTime(LEAVE_MS); });
    expect(result.current.phase).toBe("gone");

    const again = renderHook(() => useAutoDismissBanner("t", { active: true, textLength: 100 }));
    expect(again.result.current.phase).toBe("gone"); // not re-shown on the next mount
  });

  it("never writes the monthly dismissal key — ignoring a banner is not declining it", () => {
    const { result } = renderHook(() => useAutoDismissBanner("t2", { active: true, textLength: 10 }));
    act(() => { vi.advanceTimersByTime(MAX_DWELL_MS); });
    act(() => { vi.advanceTimersByTime(LEAVE_MS); });
    expect(result.current.phase).toBe("gone");
    expect(localStorage.getItem("datiq.upsellDismissedMonth")).toBeNull();
    expect(localStorage.getItem("datiq.referralDismissedMonth")).toBeNull();
  });

  it("does not run the clock while inactive, and hover pauses then restarts it", () => {
    const { result, rerender } = renderHook(({ active }) => useAutoDismissBanner("t3", { active, textLength: 10 }), { initialProps: { active: false } });
    act(() => { vi.advanceTimersByTime(MAX_DWELL_MS * 2); });
    expect(result.current.phase).toBe("shown");

    rerender({ active: true });
    act(() => { result.current.hoverProps.onMouseEnter(); });
    act(() => { vi.advanceTimersByTime(MAX_DWELL_MS * 2); });
    expect(result.current.phase).toBe("shown"); // paused under the pointer

    act(() => { result.current.hoverProps.onMouseLeave(); });
    act(() => { vi.advanceTimersByTime(dwellMs(10)); });
    expect(result.current.phase).toBe("leaving");
  });
});
