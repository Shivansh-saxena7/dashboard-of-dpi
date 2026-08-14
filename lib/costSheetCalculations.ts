// Single owner of the Cost-Sheet formula — used by the live on-screen
// preview, the PDF generator, and the share snapshot, so the math
// exists in exactly one place (Golden Rule: one owner).
//
// REAL COMPANY FORMAT (confirmed 2026-08-14 against an actual La
// Residentia cost sheet — replaces an earlier, wrong Stamp-Duty/
// Registration/GST-on-Subtotal design that was never how this company
// actually builds a cost sheet):
//
//   BSP Amount        = Area (sqft) × BSP Rate (per sqft)
//   IFMS Amount       = Area (sqft) × IFMS Rate (per sqft)
//   Lease Rent Amount = Area (sqft) × Lease Rent Rate (per sqft)
//   Total Flat Cost   = BSP + IFMS + Lease Rent
//                       + Car Parking + Club Membership + View PLC
//                       + Floor PLC + Power Backup + Dual Meter
//                       + Σ(Other Charges)
//                       — a plain sum, no exclusions.
//   Govt Charge       = Total Flat Cost × Govt Charge % (a single
//                       rate — defaults from Admin settings, but
//                       editable per-deal on the form itself)
//   Grand Total       = Total Flat Cost + Govt Charge
//
// Verified against the real sheet's own numbers: 82,63,860 × 6% =
// 4,95,831 → 87,59,691 Grand Total. Matches exactly.
export interface OtherCharge {
  label: string;
  amount: number;
}

export interface CostSheetInputs {
  area: number;
  bspRate: number;
  ifmsRate: number;
  leaseRentRate: number;
  carParking: number;
  clubMembership: number;
  viewPlc: number;
  floorPlc: number;
  powerBackup: number;
  dualMeter: number;
  otherCharges: OtherCharge[];
  govtChargePct: number;
}

export interface CostSheetResult {
  bspAmount: number;
  ifmsAmount: number;
  leaseRentAmount: number;
  totalFlatCost: number;
  govtChargePct: number;
  govtCharge: number;
  grandTotal: number;
}

export function calculateCostSheet(inputs: CostSheetInputs): CostSheetResult {
  const bspAmount = (inputs.area || 0) * (inputs.bspRate || 0);
  const ifmsAmount = (inputs.area || 0) * (inputs.ifmsRate || 0);
  const leaseRentAmount = (inputs.area || 0) * (inputs.leaseRentRate || 0);
  const otherChargesTotal = inputs.otherCharges.reduce((sum, o) => sum + (o.amount || 0), 0);

  const totalFlatCost =
    bspAmount +
    ifmsAmount +
    leaseRentAmount +
    (inputs.carParking || 0) +
    (inputs.clubMembership || 0) +
    (inputs.viewPlc || 0) +
    (inputs.floorPlc || 0) +
    (inputs.powerBackup || 0) +
    (inputs.dualMeter || 0) +
    otherChargesTotal;

  const govtChargePct = inputs.govtChargePct || 0;
  const govtCharge = totalFlatCost * (govtChargePct / 100);
  const grandTotal = totalFlatCost + govtCharge;

  return { bspAmount, ifmsAmount, leaseRentAmount, totalFlatCost, govtChargePct, govtCharge, grandTotal };
}
