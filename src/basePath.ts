/** App base URL (e.g. '/StarHorizon-Map-Editor/' on GitHub Pages, '/' locally), without trailing slash. */
export const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Prefixes a root-relative path (e.g. '/images/clown.png') with the app's base URL. */
export function withBase(path: string): string {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
