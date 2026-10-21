// Play: the setup and money flow merged behind one nav entry.
import { SectionHost } from "../components/SectionHost";
import Setup from "../money/Setup";
import Deposit from "../money/deposit";
import Mint from "../mint";

export default function Play() {
  return (
    <SectionHost
      tabs={[
        { label: "Set me up", path: "/setup", Component: Setup },
        { label: "Get a Chog", path: "/mint", Component: Mint },
        { label: "Enter the race", path: "/deposit", Component: Deposit },
      ]}
    />
  );
}
