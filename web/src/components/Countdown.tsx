import { useEffect, useState } from "react";

function format(remaining: number): string {
  const d = Math.floor(remaining / 86400);
  const h = Math.floor((remaining % 86400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d)}:${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Countdown to the next race. Takes the timestamp ONLY from the game source
 * (fixture in dev, contract after Phase 1), never a hardcoded schedule.
 * When the schedule is unknown it says so honestly.
 */
export function Countdown({ nextDrawAt, sourceLabel }: { nextDrawAt: number | null; sourceLabel: string }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (nextDrawAt === null) {
    return (
      <div className="countdown">
        <div className="countdown-value">-- : -- : -- : --</div>
        <div className="countdown-note">No draw scheduled yet. The countdown starts when the pool contract sets nextDrawAt.</div>
      </div>
    );
  }

  const remaining = Math.max(0, nextDrawAt - now);
  return (
    <div className="countdown">
      <div className="countdown-value">{format(remaining)}</div>
      <div className="countdown-note">{sourceLabel}</div>
    </div>
  );
}
