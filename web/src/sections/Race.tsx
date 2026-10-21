// Race: the run game, the replays, and the career record merged behind one
// nav entry. The draw-era race show and spectator stay in the repo as the
// code the round replays will grow from, but they are off the player's map.
import { SectionHost } from "../components/SectionHost";
import Game from "./Game";
import Replays from "./Replays";
import Career from "../career";
import { BookPanel } from "../race/BookPanel";
import { RoundPanel } from "../race/RoundPanel";

export default function Race() {
  return (
    <>
      <SectionHost
      tabs={[
        { label: "The Run", path: "/run", Component: Game },
        { label: "Replays", path: "/replays", Component: Replays },
        { label: "Career", path: "/career", Component: Career },
      ]}
    />
      <RoundPanel />
      <BookPanel />
    </>
  );
}
