import { useEffect, useState } from "react";
import { Button } from "@chogpool/ui";
import { navigate } from "../lib/router";
import { formatTime } from "../lib/format";

function format(remaining: number): string {
  const d = Math.floor(remaining / 86400);
  const h = Math.floor((remaining % 86400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d)}:${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * The note under a lapsed commit window. It says WHEN the window ended, and it
 * only promises the field will lock on close when the draw is still open: a
 * closed or already-awarded draw locked the field when the operator closed it.
 * With the draw's state unreadable, it claims neither.
 */
export function windowEndedNote(fieldLocked: boolean | null, closeAt: number): string {
  const when = `${formatTime(closeAt)} (unix ${closeAt})`;
  if (fieldLocked === true) {
    return `The commit window ended ${when}. The field is already locked: the operator closed the draw on chain.`;
  }
  if (fieldLocked === false) {
    return `The commit window ended ${when}. The field locks when the operator closes the draw on chain.`;
  }
  return `The commit window ended ${when}. The draw's state could not be read here, so this page does not say whether the field has locked.`;
}

/**
 * Countdown to the next race. Takes the timestamp ONLY from the game source
 * (fixture in dev, live contract in production), never a hardcoded schedule.
 * When the schedule is unknown it says so honestly.
 */
export function Countdown({
  nextDrawAt,
  sourceLabel,
  fieldLocked = null,
}: {
  nextDrawAt: number | null;
  sourceLabel: string;
  /** True when the draw is already closed on chain (its field is locked),
   *  false while it is still open, null when the state could not be read. */
  fieldLocked?: boolean | null;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (nextDrawAt === null || nextDrawAt <= 0) {
    return (
      <div className="countdown countdown-empty">
        <div className="standby-chip"><span className="standby-dot" />NO ACTIVE DRAW · STANDBY</div>
        <div className="countdown-value">-- : -- : -- : --</div>
        <div className="countdown-note">
          No draw scheduled yet. Draws are opened by the pool operator, not on a timer: the countdown appears
          the moment a draw is opened on chain.
        </div>
        <Button onClick={() => navigate("/deposit")}>Enter the race</Button>
      </div>
    );
  }

  const remaining = nextDrawAt - now;
  if (remaining <= 0) {
    // The close time passed. Say when it passed and what it means for the
    // field, instead of freezing on zeroes with a countdown still implied.
    return (
      <div className="countdown">
        <div className="countdown-value">00:00:00:00</div>
        <div className="countdown-note">
          {windowEndedNote(fieldLocked, nextDrawAt)} {sourceLabel}
        </div>
      </div>
    );
  }
  return (
    <div className="countdown">
      <div className="countdown-value">{format(remaining)}</div>
      <div className="countdown-note">{sourceLabel}</div>
    </div>
  );
}
