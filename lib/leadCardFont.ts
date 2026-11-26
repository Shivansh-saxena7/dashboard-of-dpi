// Lead card font (2026-10-09, design "F · Light Pro"): Plus Jakarta Sans,
// self-hosted by next/font, applied only to the employee lead card and its
// skeleton — not the rest of the app. One family; hierarchy by weight.
import { Plus_Jakarta_Sans } from "next/font/google";

export const leadCardFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
  fallback: ["system-ui", "sans-serif"]
});
