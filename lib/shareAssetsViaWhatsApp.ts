import { buildWhatsAppLink } from "./buildWhatsAppLink";

// Single owner for the WhatsApp-share mechanism — used by both the
// Project Assets module and (Part 2) the Cost-Sheet Generator.
//
// CONFIRMED VIA REAL-DEVICE TESTING (2026-08-14):
//
// 1) navigator.share({ files, text }) — the "Web Share API" — was
//    tried first as a way to get real file attachments. Wrong:
//    ShareData is only { title, text, url, files }, no field
//    anywhere in the spec for a target recipient/number, so it opens
//    the OS-level generic share/contact picker, never the client's
//    chat. Not used here at all — a hard platform limitation, not an
//    implementation gap.
//
// 2) Downloading FILE assets and then calling window.open() for the
//    WhatsApp chat, BOTH inside the same click handler, was also
//    wrong — on real mobile browsers, only the first action inside a
//    user gesture is reliably treated as user-initiated. The download
//    (a real network round-trip) breaks that chain, and the
//    window.open() that follows gets silently swallowed by the
//    browser's popup heuristics — WhatsApp never opens, no error,
//    nothing. Confirmed live: file downloaded fine, WhatsApp did not
//    open, on a real phone.
//
// So downloading files and opening the WhatsApp chat are kept as TWO
// SEPARATE exported actions, deliberately NOT chained together
// internally — the caller (LeadProjectAssetsSection) wires them to
// two distinct button taps when files are involved, so window.open()
// always runs from its own fresh, unconsumed user gesture. This is
// the only version of this that's structurally guaranteed to work
// regardless of any particular browser's popup-blocking heuristics —
// no timing/delay trick would be reliable across browsers instead.
//
// wa.me/<number>?text=... (via buildWhatsAppLink.ts, same helper the
// existing Call/WhatsApp buttons elsewhere in the app already use) is
// the only mechanism that can pre-open a specific client's chat. It
// has no file-attachment capability on any platform, so FILE assets
// are downloaded to the device separately, with the message text
// instructing the employee to attach them manually once the (correct)
// chat is already open — the best possible free option without a
// paid WhatsApp Business API integration.
//
// The download itself uses Supabase Storage's `?download` query
// param, NOT the anchor `download` HTML attribute — that attribute is
// only honored by browsers for same-origin URLs, and these Storage
// public URLs are cross-origin to the app. `?download` is honored
// server-side (Content-Disposition: attachment) regardless of origin.
// See https://supabase.com/docs/guides/storage/serving/downloads
export interface ShareableAsset {
  id: string;
  label: string;
  groupLabel: string;
  assetType: "VIDEO" | "FILE";
  url: string; // video_url for VIDEO, a resolved public Storage URL for FILE
}

function safeFilename(label: string, url: string): string {
  const base = label.replace(/[^\w.\- ]+/g, "").trim() || "file";
  if (/\.[a-zA-Z0-9]{2,5}$/.test(base)) return base;

  // Fall back to whatever extension the original storage filename had.
  const lastSegment = url.split("?")[0].split("/").pop() || "";
  const dot = lastSegment.lastIndexOf(".");
  const ext = dot >= 0 ? lastSegment.slice(dot) : "";
  return base + ext;
}

// This text goes STRAIGHT INTO THE CLIENT'S WhatsApp chat as
// pre-filled text — it must contain ONLY genuine, professional,
// client-facing content, in English. Never put employee-side
// instructions (which files to attach, etc.) here — an earlier
// version of this file did exactly that by accident (mixed a Hinglish
// "please attach these files manually" line into this same text) and
// it went straight to a real client. Employee-facing instructions
// belong in the UI (toast / on-screen card in
// LeadProjectAssetsSection), never in this function.
//
// Dynamically describes WHATEVER the employee actually selected — no
// hardcoded single-scenario text. Exactly one asset gets a natural,
// direct sentence (a "Please find the following:" list of one thing
// reads as if two things were sent when only one was — genuinely
// confusing, confirmed in real-device testing). Two or more assets
// get an itemized "Please find the following" list so the client
// always knows exactly what's coming, even though FILE assets still
// require the employee's separate manual-attach step.
function describeAssetForClient(asset: ShareableAsset): string {
  return asset.assetType === "VIDEO" ? `${asset.label} (video link below)` : `${asset.label} (attached)`;
}

function buildClientMessage(assets: ShareableAsset[], projectName?: string): string {
  if (assets.length === 0) return "";
  const project = projectName?.trim();

  // Exactly one asset selected — a direct sentence, not a list of one.
  if (assets.length === 1) {
    const a = assets[0];
    const subject = project ? `${project} — ${a.groupLabel}` : a.groupLabel;
    return a.assetType === "VIDEO"
      ? `Here is the video for ${subject}:\n${a.url}`
      : `Please find attached the ${a.label} for ${subject}.`;
  }

  // Two or more assets: group by Size/Type (matches how they're
  // grouped in the picker UI), list what's included per group, then
  // list any video links together at the end so they're easy to tap.
  const byGroup = new Map<string, ShareableAsset[]>();
  for (const a of assets) {
    if (!byGroup.has(a.groupLabel)) byGroup.set(a.groupLabel, []);
    byGroup.get(a.groupLabel)!.push(a);
  }

  const sections: string[] = [];
  for (const [groupLabel, groupAssets] of byGroup) {
    const subject = project ? `${project} — ${groupLabel}` : groupLabel;
    const itemLines = groupAssets.map((a) => `- ${describeAssetForClient(a)}`);
    sections.push(`Please find the following for ${subject}:\n${itemLines.join("\n")}`);
  }

  const videoAssets = assets.filter((a) => a.assetType === "VIDEO");
  if (videoAssets.length > 0) {
    const label = videoAssets.length > 1 ? "Video links" : "Video link";
    const videoLines = videoAssets.map((v) => {
      const subject = project ? `${project} — ${v.groupLabel} (${v.label})` : `${v.groupLabel} (${v.label})`;
      return `${subject}: ${v.url}`;
    });
    sections.push(`${label}:\n${videoLines.join("\n")}`);
  }

  return sections.join("\n\n");
}

// Call directly from the primary "Send via WhatsApp" tap. Pure
// device-side download, no navigation/window.open involved, so it
// can safely run before (and in the same gesture as) anything else.
export function downloadShareFileAssets(assets: ShareableAsset[]): void {
  const fileAssets = assets.filter((a) => a.assetType === "FILE");
  for (const a of fileAssets) {
    const filename = safeFilename(`${a.groupLabel} ${a.label}`, a.url);
    const downloadUrl = `${a.url}${a.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(filename)}`;
    const link = document.createElement("a");
    link.href = downloadUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Must be called from its OWN, separate user-gesture click handler
// whenever any FILE assets were involved — see the file-level comment
// above for why. Safe to call in the same gesture as the "Send"
// button only when there are zero FILE assets (video-only shares).
//
// Pre-filled text is built from the FULL selection (see
// buildClientMessage above) so the client always sees a clear,
// accurate description of everything being sent — never just the
// videos. projectName is optional context (the lead's project name)
// purely to make the client-facing line read naturally; omitted
// cleanly if not available.
export function openWhatsAppChatForAssets(mobile: string, assets: ShareableAsset[], projectName?: string): void {
  const message = buildClientMessage(assets, projectName);
  const url = message ? `${buildWhatsAppLink(mobile)}?text=${encodeURIComponent(message)}` : buildWhatsAppLink(mobile);
  window.open(url, "_blank");
}
