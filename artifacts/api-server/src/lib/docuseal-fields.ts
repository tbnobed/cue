import type { RemoteTemplate } from "./docuseal-client";

// Match existing PDF field names without modifying the approved document.
const aliases: Record<string, string> = {
  guestname: "GuestName", printname: "GuestName", printedname: "GuestName",
  guestemail: "GuestEmail", email: "GuestEmail", emailaddress: "GuestEmail",
  projectname: "ProjectName", nameofprogram: "ProjectName", programname: "ProjectName",
  releasetitle: "ReleaseTitle", productiondate: "ProductionDate",
};
export function prefillReleaseFields(
  fields: RemoteTemplate["fields"], uuid: string, guestUuid: string,
  values: Record<string, string>,
) {
  return fields.flatMap(field => {
    if (field.submitter_uuid !== uuid) return [];
    const key = aliases[field.name.toLowerCase().replace(/[^a-z0-9]/g, "")];
    if (!key || !values[key]) return [];
    // Generic Email / Print Name fields on a countersigner must not be filled
    // with the guest's identity.
    if (["GuestName", "GuestEmail"].includes(key) && uuid !== guestUuid) return [];
    // "Date", "Date signed", signature, initials, phone and address are never
    // inferred from production data. Explicit ProductionDate remains supported.
    if (field.type !== "text" && !(key === "ProductionDate" && field.type === "date")) return [];
    return [{ name: field.name, default_value: values[key], readonly: true }];
  });
}
