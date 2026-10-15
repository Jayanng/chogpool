import { useRef, useState } from "react";
import QRCode from "qrcode";
import { Badge, Button, Card, tokens } from "@chogpool/ui";

/**
 * Post-race share card. Renders ONLY real data we hold: the brand, the draw
 * label, a real Chog (real image + real tokenId), and, once a draw has really
 * been awarded, the winner and the prize the chain recorded. No winner or
 * prize values are ever drawn before a real draw produces them. The QR points
 * at this deployment's race page, whatever origin the site is served from.
 */
export type ShareCardResult = {
  drawId: string;
  winnerName: string;
  winnerTokenId: string;
  winnerImageUrl: string | null;
  /** Prize text, already formatted and labeled (e.g. "0.022941 USDC"). */
  potLabel: string;
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
      ? { tokenId: result.winnerTokenId, imageUrl: result.winnerImageUrl, name: result.winnerName }
      : chog;

    if (subject) {
      const bigLabel = result ? `CHOG #${result.winnerTokenId}` : subject.name;
      const subLabel = result
        ? result.winnerName !== `CHOG #${result.winnerTokenId}`
          ? `IPFS NAME: ${result.winnerName.toUpperCase()}`
          : "ON-CHAIN WINNER"
        : `CHOG #${subject.tokenId}`;
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
      ctx.fillStyle = tokens.color.lime;
      ctx.font = "500 26px 'DM Mono', monospace";
      ctx.fillText(subLabel, 348, 430);

      if (result) {
        ctx.fillStyle = tokens.color.accent;
        ctx.font = "700 30px 'Plus Jakarta Sans', system-ui, sans-serif";
        ctx.fillText("WINNER", 348, 300);
        ctx.fillStyle = tokens.color.muted;
        ctx.font = "500 24px 'DM Mono', monospace";
        ctx.fillText(`PRIZE ${result.potLabel.toUpperCase()}`, 348, 482);
        ctx.fillText("PAID FROM THE YIELD-FUNDED POT", 348, 518);
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
      footer={result ? "WINNER AND PRIZE READ FROM THE CHAIN" : "WINNER AND POT APPEAR AFTER A REAL DRAW"}
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}
