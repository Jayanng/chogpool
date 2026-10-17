// A merged section: one nav entry hosting several sub-pages behind a candy tab
// strip. Sub-pages render exactly as before; this only organises navigation.

import { type ComponentType } from "react";
import { navigate, usePath } from "../lib/router";

export type SectionTab = { label: string; path: string; Component: ComponentType };

export function SectionHost({ tabs }: { tabs: SectionTab[] }) {
  const path = usePath();
  const found = tabs.findIndex((t) => t.path === path);
  const idx = found === -1 ? 0 : found;
  const Current = tabs[idx].Component;

  return (
    <div className="section-host">
      <div className="section-tabs" role="tablist" aria-label="Section">
        {tabs.map((t, i) => (
          <button
            key={t.path}
            type="button"
            role="tab"
            aria-selected={i === idx}
            className={"section-tab" + (i === idx ? " is-active" : "")}
            onClick={() => navigate(t.path)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="section-tabpanel" role="tabpanel">
        <Current />
      </div>
    </div>
  );
}
