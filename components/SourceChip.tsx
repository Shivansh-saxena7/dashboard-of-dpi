// Lead source chip (2026-10-10): neutral raised pill with a small dot, the
// same on every lead card, sitting on its own line under the project. The
// label comes from the shared sourceLabel(); the raw value is in the
// tooltip. Nothing is rendered when the source is empty. Presentation only.
import { dotStyle, NEUTRAL_TAG, sourceDot, sourceLabel, TAG } from "@/lib/leadCardLook";

export default function SourceChip({ source }: { source: string | null | undefined }) {
  const label = sourceLabel(source);
  if (!label) return null;
  return (
    <p className="mt-1.5 flex min-w-0">
      <span className={`${TAG} min-w-0 max-w-full`} style={NEUTRAL_TAG} title={`Source: ${(source || "").trim()}`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={dotStyle(sourceDot(source))} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
    </p>
  );
}
