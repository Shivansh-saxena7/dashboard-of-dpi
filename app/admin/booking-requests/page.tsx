"use client";

import PageHeader from "@/components/PageHeader";
import BookingRequestsQueue from "@/components/BookingRequestsQueue";

// Admin / Super Admin view of the booking approval queue (2026-10-10). The
// same queue is a tab on the Coordinator dashboard.
export default function AdminBookingRequestsPage() {
  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Leads"
        title="Booking Requests"
        description="Employees ask before a lead is booked. Approve to book it (points and the team celebration happen then), or reject with a reason."
      />
      <BookingRequestsQueue />
    </div>
  );
}
