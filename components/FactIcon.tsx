// Small round icon chip shown before a facts-row label on lead cards
// (2026-10-10). Its colours come from the card's own --tone / --tone-tint
// variables (set by cardSurface), so every tone and every card type picks
// it up without extra props. Presentation only.
import { Activity, CalendarClock, Phone, PhoneOutgoing, User, UserCheck, LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  assigned: CalendarClock,
  calls: Phone,
  activity: Activity,
  attempts: PhoneOutgoing,
  owner: User,
  by: UserCheck
};

export default function FactIcon({ name }: { name: keyof typeof ICONS }) {
  const Icon = ICONS[name];
  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
      style={{ background: "var(--tone-tint, #eef2f7)", color: "var(--tone-ink, #475569)", boxShadow: "inset 0 0 0 1px var(--tone-ring, #e2e8f0)" }}
      aria-hidden="true"
    >
      <Icon size={9} strokeWidth={2.5} />
    </span>
  );
}
