// Race: the draw show and live spectating merged behind one nav entry.
import { SectionHost } from "../components/SectionHost";
import RaceShow from "../race";
import Spectator from "../spectator";

export default function Race() {
  return (
    <SectionHost
      tabs={[
        { label: "Race show", path: "/race", Component: RaceShow },
        { label: "Spectate", path: "/spectator", Component: Spectator },
      ]}
    />
  );
}
