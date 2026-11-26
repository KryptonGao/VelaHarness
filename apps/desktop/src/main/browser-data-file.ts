import type { CookiesSetDetails } from "electron";

interface ImportedOrigin {
  origin: string;
  localStorage: { name: string; value: string }[];
}

export interface BrowserImportData {
  cookies: CookiesSetDetails[];
  origins: ImportedOrigin[];
  skipped: number;
}

export interface StagedBrowserData {
  byHost: Map<string, BrowserImportData>;
  unassignedSkipped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function emptyData(): BrowserImportData {
  return { cookies: [], origins: [], skipped: 0 };
}

function siteData(staged: StagedBrowserData, hostname: string): BrowserImportData {
  let site = staged.byHost.get(hostname);
  if (!site) {
    site = emptyData();
    staged.byHost.set(hostname, site);
  }
  return site;
}

function canonicalHost(value: string): string | null {
  const host = value.toLowerCase();
  if (!host || host.length > 254 || !/^(?:[a-z\d_-]+(?:\.[a-z\d_-]+)*\.?|\[[a-f\d:]+\])$/.test(host)) return null;
  try {
    const url = new URL(`https://${host}`);
    // The export contains Chromium's canonical hostname. Reject shorthand IPs
    // and other aliases rather than silently associating a cookie with a new host.
    return url.hostname === host ? host : null;
  } catch {
    return null;
  }
}

function storageOrigin(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const match = /^https?:\/\/(\[[a-f\d:]+\]|[a-z\d._-]+)(?::\d+)?\/?$/i.exec(value);
  if (!match) return null;
  try {
    const url = new URL(value);
    return canonicalHost(match[1]) === url.hostname ? url : null;
  } catch {
    return null;
  }
}

function parseCookie(row: Record<string, unknown>, host: string): CookiesSetDetails | null {
  const { name, value, path, secure, httpOnly, expires, sameSite } = row;
  const domainCookie = typeof row.domain === "string" && row.domain.startsWith(".");
  // Electron cookies.set cannot set a partition key. Setting these cookies
  // without it would turn third-party partitioned state into ordinary cookies.
  if ("partitionKey" in row || row.partitioned === true || row.partitionKeyOpaque === true ||
      row._crHasCrossSiteAncestor === true || row.sameParty === true ||
      (row.hostOnly !== undefined && row.hostOnly !== !domainCookie)) return null;
  if (typeof name !== "string" || typeof value !== "string" || /[\u0000-\u001f\u007f;]/.test(name) ||
      /[\u0000-\u001f\u007f;]/.test(value) || typeof path !== "string" || !path.startsWith("/") ||
      /[\u0000-\u001f\u007f;]/.test(path) || typeof secure !== "boolean" || typeof httpOnly !== "boolean" ||
      typeof expires !== "number" || !Number.isFinite(expires) || (expires !== -1 && expires < 0)) return null;
  if (sameSite !== "Strict" && sameSite !== "Lax" && sameSite !== "None") return null;
  return {
    url: `${secure ? "https" : "http"}://${host}/`, name, value, path, secure, httpOnly,
    sameSite: sameSite === "None" ? "no_restriction" : sameSite === "Strict" ? "strict" : "lax",
    ...(domainCookie ? { domain: `.${host}` } : {}),
    ...(expires === -1 ? {} : { expirationDate: expires }),
  };
}

// In addition to the host's file-size limit, bound the number of objects that
// can reach Chromium. A small file can contain a very large array of primitives.
const maxRecords = 100_000;

export function parseBrowserData(input: unknown): StagedBrowserData {
  if (!isRecord(input) || !Array.isArray(input.cookies) || !Array.isArray(input.origins)) {
    throw new Error("Invalid browser storage state");
  }
  let records = input.cookies.length + input.origins.length;
  if (records > maxRecords) throw new Error("Browser storage state is too large");
  const staged: StagedBrowserData = { byHost: new Map(), unassignedSkipped: 0 };
  for (const row of input.cookies) {
    const domain = isRecord(row) && row.domain;
    const host = typeof domain === "string" && canonicalHost(domain.replace(/^\./, ""));
    if (!host) { staged.unassignedSkipped++; continue; }
    const site = siteData(staged, host);
    const cookie = parseCookie(row, host);
    if (cookie) site.cookies.push(cookie);
    else site.skipped++;
  }
  for (const row of input.origins) {
    const url = isRecord(row) && storageOrigin(row.origin);
    const entries = isRecord(row) && Array.isArray(row.localStorage) ? row.localStorage : null;
    records += entries?.length ?? 0;
    if (records > maxRecords) throw new Error("Browser storage state is too large");
    if (!url) { staged.unassignedSkipped += entries?.length ?? 1; continue; }
    if (entries?.length === 0) continue;
    const site = siteData(staged, url.hostname);
    if (!entries || "partitionKey" in row || "storageKey" in row) {
      site.skipped += entries?.length ?? 1;
      continue;
    }
    const localStorage: ImportedOrigin["localStorage"] = [];
    for (const entry of entries) {
      if (isRecord(entry) && typeof entry.name === "string" && typeof entry.value === "string") {
        localStorage.push({ name: entry.name, value: entry.value });
      } else site.skipped++;
    }
    if (localStorage.length) site.origins.push({ origin: url.origin, localStorage });
  }
  return staged;
}

export function getImportSites(staged: StagedBrowserData): string[] {
  return Array.from(staged.byHost.keys()).sort();
}

export function selectBrowserData(staged: StagedBrowserData, sites: string[] | null): BrowserImportData {
  if (sites !== null && (!Array.isArray(sites) || sites.length === 0 || sites.length > staged.byHost.size)) {
    throw new Error("Invalid browser site selection");
  }
  const data = emptyData();
  data.skipped = sites === null ? staged.unassignedSkipped : 0;
  const now = Date.now() / 1000;
  for (const host of sites === null ? staged.byHost.keys() : new Set(sites)) {
    const site = staged.byHost.get(host);
    if (!site) throw new Error("Invalid browser site selection");
    data.skipped += site.skipped;
    for (const cookie of site.cookies) {
      // Setting an expired cookie can delete the current cookie in the target.
      if (cookie.expirationDate !== undefined && cookie.expirationDate <= now) data.skipped++;
      else data.cookies.push(cookie);
    }
    for (const origin of site.origins) data.origins.push(origin);
  }
  return data;
}
