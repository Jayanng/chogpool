// Race: the run game, the replays, live spectating, and the career record merged behind one nav entry.
import { SectionHost } from "../components/SectionHost";
import Game from "./Game";
import Replays from "./Replays";
import RaceShow from "../race";
import Spectator from "../spectator";
import Career from "../career";
import { BookPanel } from "../race/BookPanel";

export default function Race() {
  return (
    <>
      <SectionHost
      tabs={[
        { label: "The Run", path: "/run", Component: Game },
        { label: "Replays", path: "/replays", Component: Replays },
        { label: "Race show", path: "/race", Component: RaceShow },
        { label: "Spectate", path: "/spectator", Component: Spectator },
        { label: "Career", path: "/career", Component: Career },
      ]}
    />
      <BookPanel />
    </>
  );
}
