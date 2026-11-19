// Accept only the project's standard HTTPS API root, with an optional trailing slash.
export function matchesProjectUrl(url, project) {
  const root = `https://${project}.supabase.co`;
  return url === root || url === root + '/';
}
