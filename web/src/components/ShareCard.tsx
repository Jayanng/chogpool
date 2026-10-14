import { useRef, useState } from "react";
import { Badge, Button, Card } from "@chogpool/ui";

/**
 * Share-card generator stub (Phase 2). Renders ONLY real data we hold:
 * the brand, the countdown label from the game source, and optionally a Chog
 * the user just looked up (real image + real tokenId). No winner or prize
 * values are ever drawn here — those exist only after a real draw (Phase 3).
 */
export function ShareCard({
  chog,
  raceLabel,
}: {
  chog: { tokenId: string; imageUrl: string | null; name: string } | null;
  raceLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState("");

  async function render(): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0d1014";
    ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = "#ff8a3d";
    ctx.fillRect(0, 0, 1200, 10);
    ctx.fillRect(0, 620, 1200, 10);

    ctx.fillStyle = "#f4f6f8";
    ctx.font = "800 64px 'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.fillText("CHOG", 72, 160);
    ctx.fillStyle = "#ff8a3d";
    ctx.fillText("TRACK", 268, 160);

    ctx.fillStyle = "#aab4be";
    ctx.font = "500 30px 'DM Mono', monospace";
    ctx.fillText(raceLabel.toUpperCase(), 72, 230);

    if (chog) {
      if (chog.imageUrl) {
        try {
          const img = await loadImage(chog.imageUrl);
          ctx.drawImage(img, 72, 300, 240, 240);
        } catch {
          ctx.fillStyle = "#1b222a";
          ctx.fillRect(72, 300, 240, 240);
        }
      }
      ctx.fillStyle = "#f4f6f8";
      ctx.font = "700 42px 'Plus Jakarta Sans', system-ui, sans-serif";
      ctx.fillText(chog.name, 348, 420);
      ctx.fillStyle = "#c6ef6d";
      ctx.font = "500 26px 'DM Mono', monospace";
      ctx.fillText(`CHOG #${chog.tokenId}`, 348, 470);
    } else {
      ctx.fillStyle = "#68737e";
      ctx.font = "500 28px 'DM Mono', monospace";
      ctx.fillText("A savings game for Chog holders.", 72, 420);
    }

    ctx.fillStyle = "#68737e";
    ctx.font = "500 22px 'DM Mono', monospace";
    ctx.fillText("READ: MONAD MAINNET · PLAY: MONAD TESTNET", 72, 585);
    setStatus("Card rendered below. Download to share.");
  }

  function download(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "chog-track-share.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    setStatus("Downloaded chog-track-share.png.");
  }

  return (
    <Card
      title="Share card"
      aside={<Badge tone="neutral">STUB · REAL DATA ONLY</Badge>}
      footer="WINNER AND POT FIELDS APPEAR ONLY AFTER A REAL DRAW (PHASE 3)"
    >
      <div className="share-actions">
        <Button onClick={() => void render()}>Render card</Button>
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
