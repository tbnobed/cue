/** Request flat, paginated folders AND projects, not a projects-only list.
 * A broad date filter keeps Wrike in its full "folders" response mode even
 * when title is blank (the unfiltered endpoint can return a folder tree).
 */
export function wrikeDiscoveryParams(search: string, token: string) {
  const params = new URLSearchParams({
    deleted: "false", descendants: "true", pageSize: "100",
    updatedDate: JSON.stringify({ start: "1970-01-01T00:00:00Z" }),
  });
  if (search.trim()) params.set("title", search.trim());
  if (token) params.set("nextPageToken", token);
  return params;
}
