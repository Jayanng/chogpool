import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Panel, Skeleton } from "@chogpool/ui";
import { navigate } from "../lib/router";
import { readCurrentRaceId } from "../lib/game";
import { formatTickets, friendlyError } from "../lib/format";
import { buildVerification, type Check, type Verification } from "./verifyDraw";

/**
 * The fairness verifier. Paste a race id and the page re-derives the winner
 * from the published seed with the exact formula DrawEngine runs, step by
 * step, against live contract reads. Green when it matches the chain's own
 * record, loud and specific when it does not.
 */
export default function Verify() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Verification | null>(null);
  const [noDraws, setNoDraws] = useState(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);

  const run = useCallback(async (drawId: bigint) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await buildVerification(drawId));
    } catch (e) {
      setReport(null);
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    readCurrentRaceId()
      .then((id) => {
        if (cancelled) return;
        if (id !== null) {
          setInput(id.toString());
          void run(id);
        } else {
          setNoDraws(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // A failed read is not "no draws": say the lookup did not answer and
        // leave the form ready for a typed race ID.
        setLookupNote(
          "The current race ID could not be read from the RPC, so this page cannot pick a race for you. Enter a race ID above to walk one.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [run]);

  const submit = useCallback(() => {
    const raw = input.trim();
    if (!/^\d{1,4}$/.test(raw)) {
      setError("Enter a race ID (a whole number, starting at 1).");
      return;
    }
    void run(BigInt(raw));
  }, [input, run]);

  return (
    <>
      <section className="page-head">
        <p className="kicker">FAIRNESS VERIFIER</p>
        <h1>Trust the math,<br /><em>then check it.</em></h1>
        <p className="lede">
          Paste a race ID and the verifier re-derives the winners from the published seed using the exact
          on-chain formula. Green check when it matches the on-chain record, loud and specific when it does not.
        </p>
      </section>

      <Panel className="feature-panel race-picker">
        <label className="field">
          <span>RACE ID</span>
          <input
            value={input}
            placeholder="Race ID (1 is the first draw)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            inputMode="numeric"
          />
        </label>
        <div className="hero-actions">
          <Button onClick={submit} disabled={busy}>{busy ? "Recomputing…" : "Recompute winners"}</Button>
          <Button variant="quiet" onClick={() => navigate("/race")}>Watch the race</Button>
        </div>
        {error && <p className="viewer-error" role="alert">{error}</p>}
        {lookupNote && <p className="viewer-note">{lookupNote}</p>}
      </Panel>

      {noDraws && (
        <Panel className="feature-panel">
          <Card title="No draws to verify yet" footer="THE VERIFIER WALKS REAL DRAWS ONLY">
            <p className="muted">
              The draw engine holds no races on chain yet, so there is nothing to re-derive. The moment
              the operator awards one, its race ID here walks the published seed and the exact formula,
              step by step.
            </p>
          </Card>
        </Panel>
      )}

      {busy && (
        <Panel className="feature-panel">
          <Skeleton variant="block" height={120} />
          <Skeleton variant="text" />
          <Skeleton variant="text" width={280} />
        </Panel>
      )}

      {report && (
        <>
          <Panel className={`verdict verdict--${report.verdict}`}>
            <Badge tone={report.verdict === "verified" ? "lime" : report.verdict === "mismatch" ? "danger" : "neutral"}>
              {report.verdict === "verified" ? "VERIFIED" : report.verdict === "mismatch" ? "MISMATCH" : "NOT VERIFIABLE YET"}
            </Badge>
            <p className="verdict-line">{report.verdictLine}</p>
          </Panel>

          {report.checks.map((check) => (
            <CheckCard key={check.key} check={check} rehearsal={report.draw.rehearsal === true} />
          ))}

          {(report.walk.length > 0 || report.steps.length > 0) && (
            <Panel className="feature-panel">
              <Card
                title="The frozen ticket walk"
                aside={
                  <Badge tone="neutral">
                    {report.draw.rehearsal === true ? "READ FROM THIS DRAW'S RECORD" : "READ FROM THE CHAIN, NOT FROM US"}
                  </Badge>
                }
                footer="EVERY WINNER SLOT'S INDEX FALLS INSIDE THESE RANGES"
              >
                <div className="verify-table-wrap">
                  <table className="verify-table">
                    <thead>
                      <tr><th>RACER</th><th>TICKETS</th><th>FROM (CUMULATIVE)</th><th>TO (CUMULATIVE)</th></tr>
                    </thead>
                    <tbody>
                      {report.walk.map((row) => {
                        const hit = report.steps.some((s) => s.picked === row.tokenId);
                        return (
                          <tr key={row.tokenId.toString()} className={hit ? "verify-table__hit" : ""}>
                            <td data-label="RACER">CHOG #{row.tokenId.toString()}</td>
                            <td data-label="TICKETS">{formatTickets(row.tickets)}</td>
                            <td data-label="FROM">{row.from.toString()}</td>
                            <td data-label="TO">{row.to.toString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="viewer-note">
                  The draw's racer list, in the order the pool froze it, with each racer's cumulative
                  ticket range. A winner slot's index falls inside exactly one row. When a slot repeats a
                  racer an earlier slot already picked, the contract walks forward to the next unpicked
                  racer instead, and that fallback can land on a racer with no row here if it holds zero
                  tickets. The rows highlighted in green hold the racers this race's slots picked. On
                  narrow screens the rows stack with every column labeled.
                </p>
              </Card>
            </Panel>
          )}
        </>
      )}
    </>
  );
}

function CheckCard({ check, rehearsal }: { check: Check; rehearsal: boolean }) {
  const tone = check.status === "pass" ? "lime" : check.status === "fail" ? "danger" : "neutral";
  const label =
    check.status === "pass" ? "CHECKS OUT" : check.status === "fail" ? "MISMATCH" : check.status === "unavailable" ? "NOT AVAILABLE" : "READINGS";
  return (
    <Panel className="feature-panel">
      <Card
        title={check.title}
        aside={<Badge tone={tone}>{label}</Badge>}
        footer={
          check.footer ??
          (check.status === "fail"
            ? rehearsal
              ? "THIS STEP DISAGREES WITH THIS DRAW'S RECORD"
              : "THIS STEP DISAGREES WITH THE CHAIN"
            : check.status === "unavailable"
              ? "STATED PLAINLY WHERE THIS ANSWER COMES FROM"
              : rehearsal
                ? "REAL KECCAK256 OVER THIS DRAW'S OWN RECORD"
                : "REAL CONTRACT READS AND REAL KECCAK256")
        }
      >
        <ul className={`verify-lines verify-lines--${check.status}`}>
          {check.lines.map((line, i) => (
            <li key={i}>{isHex(line) ? <code>{line}</code> : line}</li>
          ))}
        </ul>
      </Card>
    </Panel>
  );
}

function isHex(line: string): boolean {
  return /^(0x[a-fA-F0-9]{10,}|.*\b0x[a-fA-F0-9]{40,})/.test(line) && line.length > 60;
}
