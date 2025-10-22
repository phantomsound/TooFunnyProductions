export const looksLikeEmail = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
};

export function normalizeAdminUrl(input: string): string {
  if (typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed) return "";

  // Already has a protocol or is protocol-relative
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("?")) {
    return trimmed;
  }

  if (looksLikeEmail(trimmed)) {
    return `mailto:${trimmed}`;
  }

  if (trimmed.startsWith("www.")) {
    return `https://${trimmed}`;
  }

  const hostCandidate = trimmed.split("/")[0];
  if (/^[\w.-]+\.[\w.-]+$/.test(hostCandidate)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

