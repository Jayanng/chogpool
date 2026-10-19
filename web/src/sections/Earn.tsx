// Earn: the pool's earnings and tipping merged behind one nav entry.
import { SectionHost } from "../components/SectionHost";
import Yield from "../yield";
import Tips from "../tips";

export default function Earn() {
  return (
    <SectionHost
      tabs={[
        { label: "Yield", path: "/yield", Component: Yield },
        { label: "Tips", path: "/tips", Component: Tips },
      ]}
    />
  );
}
