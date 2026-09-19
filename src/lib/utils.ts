// OWNER: UI utilities and styles.

import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom type-scale utilities (dashboard-theme.css) are font sizes, not text colors.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["meta", "body", "lead", "kpi"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
