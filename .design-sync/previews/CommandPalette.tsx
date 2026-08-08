import { useEffect } from "react";
import { CommandPalette } from "datiq";

export function Default() {
  return <CommandPalette open={true} onClose={() => {}} />;
}

function FilteredHarness() {
  useEffect(() => {
    const t = setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="cmdpalette-input"]',
      );
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "batch");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, 30);
    return () => clearTimeout(t);
  }, []);

  return <CommandPalette open={true} onClose={() => {}} />;
}

export function FilteredQuery() {
  return <FilteredHarness />;
}
