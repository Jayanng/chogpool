import type { ChogAppearance } from "../race/chogArt";

/**
 * The race runner for a Chog whose real IPFS metadata loaded: a small mascot
 * drawn from its recorded traits (colors and marking are our design derived
 * from real trait values; see chogArt.ts for the honest boundary). Pure
 * presentation: the same appearance always draws the same sprite.
 *
 * Decorative on purpose: the lane's plate next to it carries the accessible
 * name, so the sprite itself is hidden from assistive tech.
 */
export function ChogSprite({ appearance }: { appearance: ChogAppearance }) {
  const { body, belly, accent, marking, aura, auraStrength, perk, hue } = appearance;
  return (
    <svg className="chog-sprite" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {aura && (
        <circle
          className="chog-aura"
          cx="32"
          cy="33"
          r={26 + 2 * auraStrength}
          fill={`hsl(${hue} 70% 60% / ${0.18 + 0.32 * auraStrength})`}
        />
      )}
      {perk === "cape" && (
        <path d="M20 30 Q10 42 14 54 Q22 50 24 42 Z" fill={accent} opacity="0.9" />
      )}
      {/* ears */}
      <ellipse cx="20" cy="17" rx="6" ry="9" fill={body} stroke={accent} strokeWidth="1.5" />
      <ellipse cx="44" cy="17" rx="6" ry="9" fill={body} stroke={accent} strokeWidth="1.5" />
      {/* body */}
      <ellipse cx="32" cy="36" rx="18" ry="17" fill={body} />
      {/* belly */}
      <ellipse cx="32" cy="41" rx="11" ry="11" fill={belly} />
      {/* marking from real trait values */}
      {marking === "stripe" && <path d="M32 20 L34 34 L30 34 Z" fill={accent} opacity="0.75" />}
      {marking === "spots" && (
        <>
          <circle cx="22" cy="28" r="2.6" fill={accent} opacity="0.75" />
          <circle cx="42" cy="26" r="2.2" fill={accent} opacity="0.75" />
          <circle cx="26" cy="47" r="2" fill={accent} opacity="0.6" />
        </>
      )}
      {marking === "patch" && <ellipse cx="24" cy="27" rx="7" ry="5" fill={accent} opacity="0.7" />}
      {/* eyes */}
      <ellipse cx="25" cy="31" rx="4" ry="4.6" fill="#fff" />
      <ellipse cx="39" cy="31" rx="4" ry="4.6" fill="#fff" />
      <circle cx="26" cy="32" r="2" fill="#241a24" />
      <circle cx="40" cy="32" r="2" fill="#241a24" />
      {/* mouth */}
      <path d="M28 40 Q32 43 36 40" stroke="#241a24" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* draft-night cosmetics (show only) */}
      {perk === "bandana" && (
        <path d="M18 45 Q32 53 46 45 L44 50 Q32 57 20 50 Z" fill={accent} stroke="#fff" strokeWidth="1" />
      )}
      {perk === "goggles" && (
        <>
          <rect x="19" y="27" width="26" height="8" rx="4" fill={accent} opacity="0.9" />
          <circle cx="25" cy="31" r="3.2" fill="#fff" opacity="0.9" />
          <circle cx="39" cy="31" r="3.2" fill="#fff" opacity="0.9" />
        </>
      )}
    </svg>
  );
}
