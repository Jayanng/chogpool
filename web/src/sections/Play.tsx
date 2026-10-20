// Play: the money and setup flow merged behind one nav entry.
import { SectionHost } from "../components/SectionHost";
import Deposit from "../money/deposit";
import Mint from "../mint";
import Draft from "../draft";

export default function Play() {
  return (
    <SectionHost
      tabs={[
        { label: "Get a Chog", path: "/mint", Component: Mint },
        { label: "Enter the race", path: "/deposit", Component: Deposit },
        { label: "Pick a perk", path: "/draft", Component: Draft },
      ]}
    />
  );
}
