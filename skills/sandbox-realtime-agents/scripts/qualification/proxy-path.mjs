/** Normalize path spellings before checking the external bootstrap boundary. */
export function allowedPath(raw) {
  try {
    const origin = 'http://fixture.invalid';
    let parsed = new URL(raw, origin);
    if (parsed.origin !== origin) return false;
    let path = parsed.pathname;
    for (let count = 0; count < 3; count++) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
    if (path.includes('%')) return false;
    path = path.replaceAll('\\', '/').replace(/\/{2,}/g, '/');
    parsed = new URL(path, origin);
    return parsed.pathname.replace(/\/+$/, '') !== '/v1/workspaces';
  } catch { return false; }
}
