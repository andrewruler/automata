import { URL } from "node:url";

export function ensureAllowedUrl(urlString: string, allowedDomains: string[]): void {
  let host: string;
  try {
    host = new URL(urlString).hostname.toLowerCase();
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }

  const allowed = allowedDomains.map((d) => d.toLowerCase());
  const ok = allowed.some(
    (d) => host === d || host.endsWith(`.${d}`)
  );

  if (!ok) {
    throw new Error(
      `Navigation blocked: host "${host}" is not in allowedDomains: ${allowed.join(", ")}`
    );
  }
}
