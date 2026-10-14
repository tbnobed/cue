import { createHash } from "node:crypto";
import { z } from "zod";

export class SigningError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
export function signingConfig() {
  try {
    const api = new URL(process.env.DOCUSEAL_API_URL || "");
    const publicUrl = new URL(process.env.DOCUSEAL_PUBLIC_URL || "");
    if (!["http:", "https:"].includes(api.protocol) || publicUrl.protocol !== "https:" ||
        api.username || api.password || publicUrl.username || publicUrl.password ||
        api.pathname !== "/" || publicUrl.pathname !== "/" || api.search || publicUrl.search ||
        api.hash || publicUrl.hash || !process.env.DOCUSEAL_API_KEY) throw new Error();
    return { configured: true, apiUrl: api.origin, publicUrl: publicUrl.origin };
  } catch { return { configured: false, apiUrl: null, publicUrl: null }; }
}
export async function docuseal(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const config = signingConfig();
  if (!config.configured) throw new SigningError("DocuSeal is not configured. Ask an administrator to finish server setup.", 503);
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}/api${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "X-Auth-Token": process.env.DOCUSEAL_API_KEY!, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { throw new SigningError("DocuSeal did not respond. Check its server and connection."); }
  if (!response.ok) {
    throw new SigningError(
      response.status === 401 || response.status === 403 ? "DocuSeal rejected the API credentials or permission. Check server configuration." :
      response.status === 429 ? "DocuSeal is rate limiting requests. Try again later." :
      `DocuSeal returned HTTP ${response.status}. Check the template and DocuSeal server.`,
    );
  }
  try { return await response.json(); } catch { throw new SigningError("DocuSeal returned an invalid response."); }
}
export const remoteTemplateSchema = z.object({
  id: z.number().int().positive(), name: z.string(),
  archived_at: z.string().nullable().optional(),
  submitters: z.array(z.object({ name: z.string(), uuid: z.string() })).min(1).max(20),
  fields: z.array(z.object({
    name: z.string(), type: z.string(), submitter_uuid: z.string(),
  }).passthrough()),
  schema: z.array(z.unknown()), documents: z.array(z.unknown()).optional(),
  updated_at: z.string(),
});
export type RemoteTemplate = z.infer<typeof remoteTemplateSchema>;
export function templateFingerprint(template: RemoteTemplate) {
  // Approval pins both document content/version and field/role definitions.
  // Do not hash expiring document download URLs.
  return createHash("sha256").update(JSON.stringify({
    id: template.id, updated: template.updated_at, fields: template.fields,
    schema: template.schema, submitters: template.submitters,
  })).digest("hex");
}
export const remoteSubmissionSchema = z.object({
  id: z.number().int().positive(), status: z.string(),
  completed_at: z.string().nullable().optional(),
  combined_document_url: z.string().nullable().optional(),
  template: z.object({ id: z.number() }).nullable().optional(),
  submitters: z.array(z.object({
    id: z.number().int().positive(), role: z.string(), name: z.string().nullable().optional(),
    email: z.string(), external_id: z.string().nullable().optional(),
    slug: z.string().nullable().optional(),
    status: z.string(), completed_at: z.string().nullable().optional(),
  })).min(1),
});
export type RemoteSubmission = z.infer<typeof remoteSubmissionSchema>;
export async function getSubmission(id: number) {
  // Self-hosted DocuSeal generates the combined PDF + audit certificate on
  // demand when this include parameter is requested.
  const parsed = remoteSubmissionSchema.safeParse(await docuseal(`/submissions/${id}?include=combined_document_url`));
  if (!parsed.success) throw new SigningError("DocuSeal returned incomplete submission details.");
  return parsed.data;
}
export async function downloadSignedPdf(raw: string): Promise<Buffer> {
  const config = signingConfig();
  const allowed = new Set([config.publicUrl, config.apiUrl]);
  let url: URL;
  try { url = new URL(raw); } catch { throw new SigningError("DocuSeal returned an invalid document URL."); }
  const maximum = 40 * 1024 * 1024;
  for (let hop = 0; hop < 4; hop++) {
    if (!allowed.has(url.origin) || url.username || url.password) {
      throw new SigningError("Document URL is outside the configured DocuSeal server. Filing blocked.");
    }
    // Never forward the API key to file URLs. Re-check every redirect.
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) break;
      url = new URL(location, url);
      continue;
    }
    if (!response.ok || !response.body) throw new SigningError("The signed PDF could not be downloaded.");
    if (Number(response.headers.get("content-length")) > maximum) {
      await response.body.cancel(); throw new SigningError("The signed PDF exceeds the 40 MB archive limit.");
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > maximum) throw new SigningError("The signed PDF exceeds the 40 MB archive limit.");
        chunks.push(Buffer.from(chunk.value));
      }
    } finally { await reader.cancel(); }
    const data = Buffer.concat(chunks);
    if (data.subarray(0, 5).toString() !== "%PDF-" ||
        !data.subarray(Math.max(0, data.length - 2048)).includes(Buffer.from("%%EOF"))) {
      throw new SigningError("DocuSeal did not return a valid PDF. Filing blocked.");
    }
    return data;
  }
  throw new SigningError("Too many redirects downloading the signed PDF.");
}
export const signingError = (error: unknown) =>
  error instanceof SigningError ? error.message : "Signing operation failed. Check the server and retry.";
