// Play: the money and setup flow merged behind one nav entry.
import { SectionHost } from "../components/SectionHost";
import Deposit from "../money/deposit";
import Mint from "../mint";
import Draft from "../draft";

export default function Play() {
  return (
    <SectionHost
      tabs={[
        { label: "Deposit", path: "/deposit", Component: Deposit },
        { label: "Get a Chog", path: "/mint", Component: Mint },
        { label: "Pick a racer", path: "/draft", Component: Draft },
      ]}
    />
  );
}
