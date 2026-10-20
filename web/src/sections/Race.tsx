// Race: the draw show, live spectating, and the career record merged behind one nav entry.
import { SectionHost } from "../components/SectionHost";
import RaceShow from "../race";
import Spectator from "../spectator";
import Career from "../career";
import { BookPanel } from "../race/BookPanel";

export default function Race() {
  return (
    <>
      <SectionHost
      tabs={[
        { label: "Race show", path: "/race", Component: RaceShow },
        { label: "Spectate", path: "/spectator", Component: Spectator },
        { label: "Career", path: "/career", Component: Career },
      ]}
    />
      <BookPanel />
    </>
  );
}
