export type MappedField =
  | "name"
  | "mobile"
  | "email"
  | "project"
  | "source"
  | "lead_time"
  | "priority"
  | "meta_lead_id"
  | "ignore"
  | "extra";

export const MAPPED_FIELD_OPTIONS: { value: MappedField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "mobile", label: "Mobile" },
  { value: "email", label: "Email" },
  { value: "project", label: "Project" },
  { value: "source", label: "Source" },
  { value: "lead_time", label: "Lead Time" },
  { value: "priority", label: "Priority (Hot/Warm/Cold)" },
  { value: "meta_lead_id", label: "Meta Lead ID (for Conversions API)" },
  { value: "extra", label: "Keep as Extra Data" },
  { value: "ignore", label: "Ignore" }
];

// Dependency-free "fuzzy" matching per the blueprint's spirit — no
// NLP/string-distance library, just normalize the header (lowercase,
// strip non-alphanumerics) and check it against a per-field synonym
// list. Good enough for real-world CSV headers ("Phone Number",
// "phone_number", "PHONE" all normalize the same way); anything not
// recognized defaults to "ignore" rather than guessing wrong.
const SYNONYMS: Record<Exclude<MappedField, "ignore" | "extra">, string[]> = {
  name: ["name", "fullname", "leadname", "customername", "clientname"],
  mobile: ["mobile", "phone", "phonenumber", "contact", "contactnumber", "cell", "mobileno", "mobno"],
  email: ["email", "emailaddress", "mail", "mailid"],
  project: ["project", "projectname", "property", "propertyname"],
  source: ["source", "leadsource", "platform", "channel"],
  lead_time: ["leadtime", "date", "createdat", "receivedon", "enquirydate", "timestamp", "leaddate"],
  priority: ["priority", "leadpriority", "temperature", "hotwarmcold", "leadtemp"],
  // Deliberately empty, not "id" — this wizard supports "any source"
  // (99Acres, Housing.com, Meta, or any future platform), and a bare
  // "id" column shows up on plenty of non-Meta CSVs meaning something
  // completely unrelated (a listing id, a row index). Auto-detecting
  // it globally could silently map a non-Meta CSV's own "id" into
  // meta_lead_id, which would then get sent to Meta's CAPI as a
  // fabricated lead_id — a real, hard-to-notice failure mode. Manual
  // mapping only; csv_import_mappings (see this wizard's own comment)
  // already remembers the choice per source after the first import,
  // so this costs one extra click ONCE per platform, not per import.
  meta_lead_id: []
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function guessFieldForHeader(header: string): MappedField {
  const normalized = normalizeHeader(header);

  for (const field of Object.keys(SYNONYMS) as (keyof typeof SYNONYMS)[]) {
    if (SYNONYMS[field].includes(normalized)) {
      return field;
    }
  }

  return "ignore";
}
