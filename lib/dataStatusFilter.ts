import { EMPLOYEE_SELECTABLE_STATUSES } from "./getValidNextLeadStatuses";
import { GIVEN_BY_ADMIN_FILTER, givenFilterCount, givenFilterLeads, type GivenAssignmentFields, type GivenLeadContext } from "./givenLeadContext";
import { LEAD_STATUS_DISPLAY } from "./leadStatusDisplay";
import { isUntouchedInCurrentAssignment, type AssignmentTouchFields } from "./newLeadFilter";
import { NEEDS_CALL_FILTER, NEEDS_CALL_LABEL, needsCallFilterLeads, type NeedsCallState } from "./needsYourCall";

// Status dropdown on the employee Data page (2026-11-04). The same rules as the Leads page Status filter, from the same
// places: "New" is lib/newLeadFilter, "Given by admin" is lib/givenLeadContext, labels are LEAD_STATUS_DISPLAY, the rest is
// EMPLOYEE_SELECTABLE_STATUSES. Follow-up, Visit and Booking are board stages, so they stay as the tabs.
// Pure functions, known-answer tested in scripts/check-data-status-filter.js.

export interface DataFilterLead {
  id: string;
  status: string;
  lead_history?: (AssignmentTouchFields & GivenAssignmentFields)[] | null;
}

export interface DataStatusOption {
  value: string;
  label: string;
  count: number;
}

export function isDataStatusFilterValue(value: unknown): value is string {
  return (
    value === "" ||
    value === "NEW" ||
    value === GIVEN_BY_ADMIN_FILTER ||
    value === NEEDS_CALL_FILTER ||
    (EMPLOYEE_SELECTABLE_STATUSES as readonly unknown[]).includes(value)
  );
}

const NO_NEEDS_CALL: NeedsCallState = { enabled: false, byLeadId: new Map() };

export function dataFilterByStatus<T extends DataFilterLead>(leads: T[], filter: string, byLeadId: Map<string, GivenLeadContext>, needsCall: NeedsCallState = NO_NEEDS_CALL): T[] {
  if (!filter) return leads;
  if (filter === NEEDS_CALL_FILTER) return needsCallFilterLeads(leads, needsCall.byLeadId);
  if (filter === GIVEN_BY_ADMIN_FILTER) return givenFilterLeads(leads, byLeadId);
  if (filter === "NEW") return leads.filter((lead) => isUntouchedInCurrentAssignment(lead.lead_history?.[0]));
  return leads.filter((lead) => lead.status === filter);
}

export function dataStatusOptions(leads: DataFilterLead[], givenEnabled: boolean, byLeadId: Map<string, GivenLeadContext>, needsCall: NeedsCallState = NO_NEEDS_CALL): DataStatusOption[] {
  const options: DataStatusOption[] = [{ value: "", label: "All statuses", count: leads.length }];
  if (needsCall.enabled) options.push({ value: NEEDS_CALL_FILTER, label: NEEDS_CALL_LABEL, count: needsCallFilterLeads(leads, needsCall.byLeadId).length });
  if (givenEnabled) options.push({ value: GIVEN_BY_ADMIN_FILTER, label: "Given by admin", count: givenFilterCount(leads, byLeadId) });
  options.push({ value: "NEW", label: LEAD_STATUS_DISPLAY.NEW.label, count: dataFilterByStatus(leads, "NEW", byLeadId).length });
  for (const status of EMPLOYEE_SELECTABLE_STATUSES) {
    options.push({ value: status, label: LEAD_STATUS_DISPLAY[status].label, count: leads.filter((lead) => lead.status === status).length });
  }
  return options;
}

export function dataStatusOptionText(option: DataStatusOption): string {
  return `${option.label} (${option.count})`;
}

// A saved "Given by admin" stays saved while the feature loads; it counts as All only when the feature is off.
export function effectiveDataStatusFilter(filter: string, givenEnabled: boolean, needsCallEnabled: boolean = false): string {
  if (filter === NEEDS_CALL_FILTER && !needsCallEnabled) return "";
  return filter === GIVEN_BY_ADMIN_FILTER && !givenEnabled ? "" : filter;
}

const storageKey = (employeeId: string) => `data_status_filter:${employeeId}`;

export function readSavedDataStatusFilter(employeeId: string): string {
  try {
    const saved = sessionStorage.getItem(storageKey(employeeId));
    return isDataStatusFilterValue(saved) ? saved : "";
  } catch {
    return "";
  }
}

export function saveDataStatusFilter(employeeId: string, filter: string): void {
  try {
    sessionStorage.setItem(storageKey(employeeId), filter);
  } catch {
    // no storage: the filter just lasts until the page closes
  }
}
