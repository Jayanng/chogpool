import { useCallback, useState } from "react";
import { Badge, Button, Card, Panel } from "@chogpool/ui";
import { navigate } from "../lib/router";
import { parseRunRecord, verifyRunRecord, type RunCheck, type RunVerification } from "../game/runRecord";

/**
 * The run verifier. Paste the run record the game copies at the finish line
 * and this page plays it back through the exact simulation the game used:
 * the published course seed, the input tape, the one revive if there was
 * one. Green when every claimed number recomputes, loud and specific when
 * one does not. Nothing is sent anywhere: the simulation runs in this page.
 */
export default function Verify() {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RunVerification | null>(null);
  const [tapeLength, setTapeLength] = useState(0);

  const submit = useCallback(() => {
    const parsed = parseRunRecord(input);
    if (parsed.error !== null) {
      setReport(null);
      setError(parsed.error);
      return;
    }
    setError(null);
    setTapeLength(parsed.record.inputs.length);
    setReport(verifyRunRecord(parsed.record));
  }, [input]);

  return (
    <>
      <section className="page-head">
        <p className="kicker">RUN VERIFIER</p>
        <h1>Trust the math,<br /><em>then check it.</em></h1>
        <p className="lede">
          Paste a run record and this page plays it back through the exact simulation the game used,
          from the published course seed and the input tape. Green when the numbers recompute, loud
          and specific when they do not.
        </p>
      </section>

      <Panel className="feature-panel race-picker">
        <label className="field">
          <span>RUN RECORD</span>
          <textarea
            rows={6}
            placeholder='{"version":1,"seed":"...","inputs":[...]}'
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <div className="hero-actions">
          <Button onClick={submit} disabled={input.trim() === ""}>Re-run the record</Button>
          <Button variant="quiet" onClick={() => navigate("/run")}>Get a record from a run</Button>
        </div>
        {error && <p className="viewer-error" role="alert">{error}</p>}
      </Panel>

      {!report && !error && (
        <Panel className="feature-panel">
          <div className="verify-idle">
            <svg width="42" height="42" viewBox="0 0 40 40" fill="none"><circle cx="18" cy="18" r="11" stroke="currentColor" strokeWidth="2.5" /><path d="M26 26l7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
            <h3>Ready to verify a run</h3>
            <p>
              Finish a run and copy its record from the finish screen, then paste it above. The
              verifier replays every press of the run and recomputes its numbers.
            </p>
          </div>
        </Panel>
      )}

      {report && (
        <>
          <Panel className={`verdict verdict--${report.ok ? "verified" : "mismatch"}`}>
            <Badge tone={report.ok ? "lime" : "danger"}>
              {report.ok ? "RUN PROVEN" : "RUN FAILED"}
            </Badge>
            <p className="verdict-line">
              {report.ok
                ? `Every claimed number recomputed from the seed and the ${tapeLength}-press tape.`
                : `At least one claimed number did not recompute from the seed and the ${tapeLength}-press tape.`}
            </p>
          </Panel>

          <Panel className="feature-panel">
            <Card title="The replay" footer="THE SIMULATION RUNS IN THIS PAGE, NOTHING IS SENT ANYWHERE">
              <ul className={`verify-lines verify-lines--${report.ok ? "pass" : "fail"}`}>
                {report.checks.map((check) => (
                  <CheckLine key={check.label} check={check} />
                ))}
              </ul>
              <p className="viewer-note">
                The course is rebuilt from its seed, the tape is played press by press, and the one
                revive is applied where the record says it happened. Recomputed numbers come from the
                same simulation the game played, never from the sender.
              </p>
            </Card>
          </Panel>
        </>
      )}
    </>
  );
}

function CheckLine({ check }: { check: RunCheck }) {
  return (
    <li>
      <Badge tone={check.ok ? "lime" : "danger"}>{check.ok ? "PASS" : "FAIL"}</Badge>{" "}
      <strong>{check.label}</strong>: {check.detail}
    </li>
  );
}
