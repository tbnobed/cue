import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { Document } from "@workspace/api-client-react";

/**
 * Mirrors the desktop tile behaviour in `pages/documents/index.tsx`:
 *
 *   1. If the doc is an external link (http/https `url`) → open the URL.
 *   2. If Collabora is enabled and the file is an office format → open the
 *      Collabora launcher in a new tab (real LibreOffice editor).
 *   3. Otherwise → navigate to the in-app editor at `/documents/:id/edit`.
 *
 * Mobile previously hard-coded path 3 for every file, which is why office
 * docs fell back to a non-editable plain-text view.
 */

const COLLABORA_EXTS = new Set([
  "csv", "tsv", "txt", "md", "markdown", "rtf",
  "doc", "docx", "odt", "xls", "xlsx", "ods", "ppt", "pptx", "odp",
]);

export function isExternalLink(doc: Document): boolean {
  return !!doc.url && /^https?:\/\//i.test(doc.url);
}

function extOf(doc: Document): string {
  // Server stores the original filename in `url` for uploads (e.g. "spec.xlsx").
  // For external links it's an absolute URL — we won't reach this path for those.
  return (doc.url ?? "").split(".").pop()?.toLowerCase() ?? "";
}

export function useAppConfig() {
  return useQuery<{ collaboraEnabled: boolean }>({
    queryKey: ["app-config"],
    queryFn: async () => {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const r = await fetch(`${base}/api/config`, { credentials: "include" });
      if (!r.ok) return { collaboraEnabled: false };
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Returns an `onClick`-style opener for a document. Caller is expected to
 * stop event propagation if the click target sits inside a containing link.
 */
export function useOpenDocument() {
  const [, navigate] = useLocation();
  const { data: cfg } = useAppConfig();
  const collaboraEnabled = !!cfg?.collaboraEnabled;

  return function open(doc: Document) {
    if (isExternalLink(doc)) {
      window.open(doc.url!, "_blank", "noopener,noreferrer");
      return;
    }
    const ext = extOf(doc);
    if (collaboraEnabled && COLLABORA_EXTS.has(ext)) {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const url = `${base}/collabora-launcher.html?docId=${doc.id}&base=${encodeURIComponent(base)}`;
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    navigate(`/documents/${doc.id}/edit`);
  };
}
