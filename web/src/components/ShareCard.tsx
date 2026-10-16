import { useRef, useState } from "react";
import QRCode from "qrcode";
import { Badge, Button, Card, tokens } from "@chogpool/ui";
import { ipfsName, prizeCanvasLabel, splitCanvasLabel } from "../lib/result-copy";

/**
 * Post-race share card. Renders ONLY real data we hold: the brand, the draw
 * label, real Chogs (real images + real tokenIds), and, once a draw has really
 * been awarded, every winner the chain recorded and the prize each one was
 * paid. No winner or prize values are ever drawn before a real draw produces
 * them. The QR points at this deployment's race page, whatever origin the site
 * is served from.
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
};

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

      // Name list, right of the thumbnails (x 348..920 keeps clear of the QR).
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
          ctx.fillText(label, 348, 344 + i * 36);
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
          ctx.fillText(label, 348 + Math.floor(i / perCol) * 302, 338 + (i % perCol) * 28);
        }
      } else {
        const fontSize = result.winners.length > 40 ? 10 : result.winners.length > 27 ? 12 : 16;
        const lineHeight = Math.round(fontSize * 1.45);
        ctx.font = `500 ${fontSize}px 'DM Mono', monospace`;
        const lines = wrapLabels(
          ctx,
          result.winners.map((w) => `CHOG #${w.tokenId}`),
          572,
          Math.floor(118 / lineHeight),
        );
        lines.forEach((line, i) => ctx.fillText(line, 348, 338 + i * lineHeight));
      }

      ctx.fillStyle = tokens.color.accent;
      ctx.font = "700 30px 'Plus Jakarta Sans', system-ui, sans-serif";
      ctx.fillText(prizeCanvasLabel(drawWinners(result), result.potLabel, result.zeroPot).toUpperCase(), 348, 482);
      ctx.fillStyle = tokens.color.muted;
      ctx.font = "500 24px 'DM Mono', monospace";
      ctx.fillText(splitCanvasLabel(drawWinners(result), result.zeroPot).toUpperCase(), 348, 518);
    } else if (subject) {
      const winner = result?.winners[0] ?? null;
      const name = winner
        ? ipfsName(winner.tokenId, winner.name)
        : ipfsName(subject.tokenId, subject.name);
      // Token IDs lead; the IPFS name, when there is a real one, rides beneath.
      const bigLabel = `CHOG #${winner ? winner.tokenId : subject.tokenId}`;
      const subLabel = name
        ? `IPFS NAME: ${name.toUpperCase()}`
        : result
          ? "ON-CHAIN WINNER"
          : "";
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
      ctx.fillText(bigLabel, 348, 380);
      if (subLabel) {
        ctx.fillStyle = tokens.color.lime;
        ctx.font = "500 26px 'DM Mono', monospace";
        ctx.fillText(subLabel, 348, 430);
      }

      if (result) {
        ctx.fillStyle = tokens.color.accent;
        ctx.font = "700 30px 'Plus Jakarta Sans', system-ui, sans-serif";
        ctx.fillText("WINNER", 348, 300);
        ctx.fillStyle = tokens.color.muted;
        ctx.font = "500 24px 'DM Mono', monospace";
        ctx.fillText(prizeCanvasLabel(drawWinners(result), result.potLabel, result.zeroPot).toUpperCase(), 348, 482);
        ctx.fillText(splitCanvasLabel(drawWinners(result), result.zeroPot).toUpperCase(), 348, 518);
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
      aside={<Badge tone={result ? "lime" : "neutral"}>{result ? "REAL DRAW RESULT" : "PREVIEW · REAL DATA ONLY"}</Badge>}
      footer={
        result
          ? result.winners.length > 1
            ? "WINNERS AND PRIZE READ FROM THE CHAIN"
            : "WINNER AND PRIZE READ FROM THE CHAIN"
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

/** Greedy wrap of the packed winner list, one whole "CHOG #id" per unit so an
 *  id never tears across lines. When even the tightest list cannot fit, the
 *  last line counts the rest instead of overlapping anything. */
function wrapLabels(
  ctx: CanvasRenderingContext2D,
  units: string[],
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const unit of units) {
    const probe = line ? `${line} · ${unit}` : unit;
    if (line && ctx.measureText(probe).width > maxWidth) {
      lines.push(line);
      line = unit;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const shown = kept.join(" ").split(" ").filter((w) => w.startsWith("#")).length;
  kept[maxLines - 1] += ` · and ${units.length - shown} more`;
  return kept;
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
