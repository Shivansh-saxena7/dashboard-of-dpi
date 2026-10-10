"use client";

// Makes every framer-motion animation follow the viewer's "reduce motion"
// setting: slide / scale effects are skipped, opacity fades still run.
// Presentation only.
import { MotionConfig } from "framer-motion";

export default function MotionPrefs({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
