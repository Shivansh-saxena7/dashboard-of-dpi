// "Booking pending approval" chip for the lead / data card tags row
// (2026-10-10). Amber, same raised pill family as the other card tags.
import { Hourglass } from "lucide-react";
import { TAG, TINT_TAG } from "@/lib/leadCardLook";

export default function BookingPendingChip() {
  return (
    <span className={TAG} style={TINT_TAG.warm} title="Waiting for an Admin or Sales Coordinator to approve the booking">
      <Hourglass size={11} strokeWidth={2.25} aria-hidden="true" />
      Booking pending approval
    </span>
  );
}
