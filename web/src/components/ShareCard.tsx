import { useRef, useState } from "react";
import QRCode from "qrcode";
import { Badge, Button, Card, tokens } from "@chogpool/ui";
import {
  ipfsName,
  prizeCanvasLabel,
  REHEARSAL_STRIP,
  shareBadgeLabel,
  shareFooterLabel,
  shareSubLabel,
  splitCanvasLabel,
} from "../lib/result-copy";

/**
 * Post-race share card. Renders ONLY real data we hold: the brand, the draw
 * label, real Chogs (real images + real tokenIds), and, once a draw has really
 * been awarded, every winner the chain recorded and the prize each one was
 * paid. No winner or prize values are ever drawn before a real draw produces
 * them. The QR points at this deployment's race page, whatever origin the site
 * is served from.
 *
 * Every name-bearing line is measured against its own column and clipped to
 * it, so a long IPFS name can never run into the QR block or into the column
 * beside it.
 */
export type ShareCardWinner = {
  tokenId: string;
  /** IPFS metadata name as recorded, or null when metadata has none or is
   *  unreachable. Names like "CHOG #954" are collection numbering, not names,
   *  and render as absent. */
  name: string | null;
  imageUrl: string | null;
};

export type ShareCardResult = {
  drawId: string;
  /** Every winner the chain recorded for this draw, in payout order. */
  winners: ShareCardWinner[];
  /** Per-winner prize text, already formatted and labeled (e.g. "0.022941 USDC"). */
  potLabel: string;
  /** True when the per-winner prize is zero: the card then says so instead of
   *  claiming a payment. */
  zeroPot: boolean;
  /** True for a draw that exists only in its own record: the card then wears
   *  the rehearsal strip and drops every "read from the chain" claim. */
  rehearsal?: boolean;
};

/** Winner text lives left of the QR block (x 952..1148) and ends by x 920 at
 *  most. The two-column list splits x 348..920 into two measured columns with
 *  a gap between them. Exported so the tests measure the same budgets the
 *  canvas draws against. */
export const NAME_LEFT = 348;
export const NAME_RIGHT = 920;
export const WIDE_LABEL_MAX = NAME_RIGHT - NAME_LEFT;
export const COL2_LEFT = 650;
export const COL1_MAX = COL2_LEFT - NAME_LEFT - 20;
export const COL2_MAX = NAME_RIGHT - COL2_LEFT;

export function ShareCard({
  chog,
  raceLabel,
  result = null,
}: {
  chog: { tokenId: string; imageUrl: string | null; name: string } | null;
  raceLabel: string;
  result?: ShareCardResult | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState("");

  async function render(): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = tokens.color.ground;
    ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = tokens.color.accent;
    ctx.fillRect(0, 0, 1200, 10);
    ctx.fillRect(0, 620, 1200, 10);

    ctx.fillStyle = tokens.color.ink;
    ctx.font = "800 64px 'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.fillText("CHOG", 72, 160);
    ctx.fillStyle = tokens.color.accent;
    ctx.fillText("TRACK", 268, 160);

    ctx.fillStyle = tokens.color.muted;
    ctx.font = "500 30px 'DM Mono', monospace";
    ctx.fillText(raceLabel.toUpperCase(), 72, 230);

    // A rehearsal card says so ON the canvas too, so a downloaded PNG cannot
    // travel without its disclosure.
    if (result?.rehearsal) {
      ctx.fillStyle = tokens.color.accent;
      ctx.font = "700 22px 'DM Mono', monospace";
      ctx.fillText(REHEARSAL_STRIP, 72, 262);
    }

    const subject = result
      ? { tokenId: result.winners[0]?.tokenId ?? "", imageUrl: result.winners[0]?.imageUrl ?? null, name: result.winners[0]?.name }
      : chog;

    if (result && result.winners.length > 1) {
      // Several winners: every winner stays visible. Up to six are pictured in
      // the left margin and every winner is named on the right, packed tighter
      // as the field grows so no line ever touches the prize copy. Only a field
      // too large for any legible list falls back to a count line that points
      // at the podium and the verifier, which name every winner between them.
      // The prize line says the per-winner share, never the whole pot.
      ctx.fillStyle = tokens.color.accent;
      ctx.font = "700 30px 'Plus Jakarta Sans', system-ui, sans-serif";
      ctx.fillText("WINNERS", 348, 300);

      // Thumbnails wrap down the left margin, capped at six: the name list
      // beside them is what keeps every winner on the card.
      const thumbSize = 72;
      const thumbStep = 84;
      const thumbsShown = Math.min(result.winners.length, 6);
      for (let i = 0; i < thumbsShown; i++) {
        const winner = result.winners[i];
        const x = 72 + (i % 2) * thumbStep;
        const y = 284 + Math.floor(i / 2) * thumbStep;
        let drawn = false;
        if (winner.imageUrl) {
          try {
            const img = await loadImage(winner.imageUrl);
            ctx.drawImage(img, x, y, thumbSize, thumbSize);
            drawn = true;
          } catch {
            drawn = false;
          }
        }
        if (!drawn) {
          ctx.fillStyle = tokens.color.panel;
          ctx.fillRect(x, y, thumbSize, thumbSize);
        }
      }

      // Name list, right of the thumbnails. Every label is measured against
      // its own column width and clipped to it, so nothing crosses x 920 into
      // the QR block or into the column beside it.
      const nameOf = (winner: ShareCardWinner): string | null =>
        ipfsName(winner.tokenId, winner.name);
      ctx.fillStyle = tokens.color.ink;
      if (result.winners.length <= 4) {
        ctx.font = "500 24px 'DM Mono', monospace";
        for (let i = 0; i < result.winners.length; i++) {
          const winner = result.winners[i];
          const name = nameOf(winner);
          const label = name
            ? `CHOG #${winner.tokenId} · IPFS NAME: ${name.toUpperCase()}`
            : `CHOG #${winner.tokenId}`;
          ctx.fillText(fitLabel(ctx, label, WIDE_LABEL_MAX), NAME_LEFT, 344 + i * 36);
        }
      } else if (result.winners.length <= 10) {
        ctx.font = "500 18px 'DM Mono', monospace";
        // Two balanced columns: the split is even so no lone entry sits in a
        // column of its own.
        const perCol = Math.ceil(result.winners.length / 2);
        for (let i = 0; i < result.winners.length; i++) {
          const winner = result.winners[i];
          const name = nameOf(winner);
          const label = name
            ? `CHOG #${winner.tokenId} · ${name.toUpperCase()}`
            : `CHOG #${winner.tokenId}`;
          const col2 = Math.floor(i / perCol) === 1;
          ctx.fillText(
            fitLabel(ctx, label, col2 ? COL2_MAX : COL1_MAX),
            col2 ? COL2_LEFT : NAME_LEFT,
            338 + (i % perCol) * 28,
          );
        }
      } else {
        const fontSize = result.winners.length > 40 ? 10 : result.winners.length > 27 ? 12 : 16;
        const lineHeight = Math.round(fontSize * 1.45);
        ctx.font = `500 ${fontSize}px 'DM Mono', monospace`;
        const lines = wrapLabels(
          ctx,
          result.winners.map((w) => `CHOG #${w.tokenId}`),
          WIDE_LABEL_MAX,
          Math.floor(118 / lineHeight),
        );
        lines.forEach((line, i) => ctx.fillText(line, NAME_LEFT, 338 + i * lineHeight));
      }

      ctx.fillStyle = tokens.color.accent;
      ctx.font = "700 30px 'Plus Jakarta Sans', system-ui, sans-serif";
      ctx.fillText(
        fitLabel(ctx, prizeCanvasLabel(drawWinners(result), result.potLabel, result.zeroPot).toUpperCase(), WIDE_LABEL_MAX),
        NAME_LEFT,
        482,
      );
      ctx.fillStyle = tokens.color.muted;
      ctx.font = "500 24px 'DM Mono', monospace";
      ctx.fillText(
        fitLabel(ctx, splitCanvasLabel(drawWinners(result), result.zeroPot, result.rehearsal === true).toUpperCase(), WIDE_LABEL_MAX),
        NAME_LEFT,
        518,
      );
    } else if (subject) {
      const winner = result?.winners[0] ?? null;
      const name = winner
        ? ipfsName(winner.tokenId, winner.name)
        : ipfsName(subject.tokenId, subject.name);
      // Token IDs lead; the IPFS name, when there is a real one, rides beneath.
      // Both lines are measured and clipped to the name column.
      const bigLabel = `CHOG #${winner ? winner.tokenId : subject.tokenId}`;
      const subLabel = shareSubLabel(name, result !== null && result !== undefined, result?.rehearsal === true);
      if (subject.imageUrl) {
        try {
          const img = await loadImage(subject.imageUrl);
          ctx.drawImage(img, 72, 280, 240, 240);
        } catch {
          ctx.fillStyle = tokens.color.panel;
          ctx.fillRect(72, 280, 240, 240);
        }
      } else {
        ctx.fillStyle = tokens.color.panel;
        ctx.fillRect(72, 280, 240, 240);
      }
      ctx.fillStyle = tokens.color.ink;
      ctx.font = "700 42px 'Plus Jakarta Sans', system-ui, sans-serif";
      ctx.fillText(fitLabel(ctx, bigLabel, WIDE_LABEL_MAX), NAME_LEFT, 380);
      if (subLabel) {
        ctx.fillStyle = result?.rehearsal === true ? tokens.color.accent : tokens.color.lime;
        ctx.font = "500 26px 'DM Mono', monospace";
        ctx.fillText(fitLabel(ctx, subLabel, WIDE_LABEL_MAX), NAME_LEFT, 430);
      }

      if (result) {
        ctx.fillStyle = tokens.color.accent;
        ctx.font = "700 30px 'Plus Jakarta Sans', system-ui, sans-serif";
        ctx.fillText("WINNER", NAME_LEFT, 300);
        ctx.fillStyle = tokens.color.muted;
        ctx.font = "500 24px 'DM Mono', monospace";
        ctx.fillText(
          fitLabel(ctx, prizeCanvasLabel(drawWinners(result), result.potLabel, result.zeroPot).toUpperCase(), WIDE_LABEL_MAX),
          NAME_LEFT,
          482,
        );
        ctx.fillText(
          fitLabel(ctx, splitCanvasLabel(drawWinners(result), result.zeroPot, result.rehearsal === true).toUpperCase(), WIDE_LABEL_MAX),
          NAME_LEFT,
          518,
        );
      }
    } else {
      ctx.fillStyle = tokens.color.faint;
      ctx.font = "500 28px 'DM Mono', monospace";
      ctx.fillText("A savings game for Chog holders.", 72, 420);
    }

    // QR to the race page of this exact deployment.
    try {
      const url = new URL("/race", window.location.origin).toString();
      const qrDataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        width: 320,
        color: { dark: tokens.color.ground, light: tokens.color.ink },
      });
      const qr = await loadImage(qrDataUrl);
      ctx.fillStyle = tokens.color.ink;
      ctx.fillRect(952, 300, 196, 196);
      ctx.drawImage(qr, 960, 308, 180, 180);
      ctx.fillStyle = tokens.color.faint;
      ctx.font = "500 16px 'DM Mono', monospace";
      ctx.fillText("SCAN FOR THE NEXT RACE", 930, 522);
    } catch {
      // A QR that cannot render is simply left out; the card never fakes one.
    }

    ctx.fillStyle = tokens.color.faint;
    ctx.font = "500 22px 'DM Mono', monospace";
    ctx.fillText("READ: MONAD MAINNET · PLAY: MONAD TESTNET", 72, 585);
    setStatus("Card rendered below. Download to share.");
  }

  function download(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = result ? `chog-track-race-${result.drawId}.png` : "chog-track-share.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    setStatus(`Downloaded ${link.download}.`);
  }

  return (
    <Card
      title={result ? `Race ${result.drawId} share card` : "Share card"}
      aside={
        <Badge tone={result ? (result.rehearsal === true ? "neutral" : "lime") : "neutral"}>
          {result ? shareBadgeLabel(result.rehearsal === true) : "PREVIEW · REAL DATA ONLY"}
        </Badge>
      }
      footer={
        result
          ? shareFooterLabel(result.winners.length, result.rehearsal === true)
          : "WINNER AND POT APPEAR AFTER A REAL DRAW"
      }
    >
      <div className="share-actions">
        <Button onClick={() => void render()}>{result ? "Render the race card" : "Render card"}</Button>
        <Button variant="outline" onClick={download}>Download PNG</Button>
      </div>
      {status && <p className="share-status">{status}</p>}
      <canvas ref={canvasRef} width={1200} height={630} className="share-canvas" aria-label="Share card preview" />
    </Card>
  );
}

/** The prize labels are built from the winner count, so the card never claims
 *  one winner took a pot that was actually split. */
function drawWinners(result: ShareCardResult): bigint[] {
  return result.winners.map((w) => BigInt(w.tokenId));
}

/**
 * Greedy wrap of the packed winner list, one whole "CHOG #id" per unit so an
 *  id never tears across lines. When even the tightest list cannot fit, the
 *  last line counts the rest instead of overlapping anything, and it is
 *  re-measured with that count suffix so the finished line still stays inside
 *  the column.
 */
export function wrapLabels(
  ctx: CanvasRenderingContext2D,
  units: string[],
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: { text: string; count: number }[] = [];
  let line = { text: "", count: 0 };
  for (const unit of units) {
    const probe = line.text ? `${line.text} · ${unit}` : unit;
    if (line.text && ctx.measureText(probe).width > maxWidth) {
      lines.push(line);
      line = { text: unit, count: 1 };
    } else {
      line = { text: probe, count: line.count + 1 };
    }
  }
  if (line.text) lines.push(line);
  if (lines.length <= maxLines) return lines.map((l) => l.text);

  const kept = lines.slice(0, maxLines).map((l) => ({ ...l }));
  let shown = kept.reduce((acc, l) => acc + l.count, 0);
  const last = kept[kept.length - 1];
  const suffix = (rest: number) => ` · and ${rest} more`;
  // Make room for the count line by dropping tail units until the finished
  // line measures inside the column.
  while (last.count > 0 && ctx.measureText(last.text + suffix(units.length - shown)).width > maxWidth) {
    const cut = last.text.lastIndexOf(" · ");
    last.text = cut === -1 ? "" : last.text.slice(0, cut);
    last.count -= 1;
    shown -= 1;
  }
  const rest = units.length - shown;
  if (rest > 0) {
    last.text = last.text ? `${last.text}${suffix(rest)}` : `and ${rest} more`;
  }
  return kept.map((l) => l.text);
}

/**
 * Fit one label to its column: anything wider than maxWidth is cut back to the
 * longest prefix that still measures inside, with an ellipsis marking the cut.
 * Called with the font already set for that line.
 */
export function fitLabel(ctx: CanvasRenderingContext2D, label: string, maxWidth: number): string {
  if (ctx.measureText(label).width <= maxWidth) return label;
  let lo = 0;
  let hi = label.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${label.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${label.slice(0, lo)}…`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}
