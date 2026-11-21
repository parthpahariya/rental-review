import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  value: function () {
    this.setAttribute("open", "");
  },
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
);

/**
 * jsdom has no IntersectionObserver. This one only fires when a test calls
 * scrollToListEnd(), so tests decide when infinite scroll loads more.
 */
type Observed = { callback: IntersectionObserverCallback; target: Element };
const observed = new Set<Observed>();
class TestIntersectionObserver {
  private entries: Observed[] = [];
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    const entry = { callback: this.callback, target };
    this.entries.push(entry);
    observed.add(entry);
  }
  disconnect() {
    for (const entry of this.entries) observed.delete(entry);
    this.entries = [];
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
Object.defineProperty(globalThis, "IntersectionObserver", {
  value: TestIntersectionObserver,
  configurable: true,
  writable: true,
});
export function scrollToListEnd() {
  for (const { callback, target } of [...observed])
    callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
}
