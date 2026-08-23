const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
];

function isBlockedIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second, third] = parts.map(Number);
  return (
    first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
  );
}

function isBlockedIpv6(hostname) {
  if (!hostname.includes(":")) return false;
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    value === "::"
    || value === "::1"
    || value.startsWith("fc")
    || value.startsWith("fd")
    || /^fe[89ab]/.test(value)
    || value.startsWith("2001:db8:")
    || value.startsWith("::ffff:")
  );
}

export function normalizePublicArticleUrl(rawValue, base) {
  const input = String(rawValue || "").trim();
  if (!input || input.length > 4096) return null;
  let url;
  try {
    url = new URL(input, base);
  } catch {
    return null;
  }

  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (url.port && !["80", "443"].includes(url.port)) return null;

  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (
    !hostname
    || hostname === "localhost"
    || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    || isBlockedIpv4(hostname)
    || isBlockedIpv6(hostname)
  ) return null;

  url.hostname = hostname;
  url.hash = "";
  return url.href;
}

export function looksLikeArticleUrl(value) {
  const input = String(value || "").trim();
  return /^https?:\/\//i.test(input)
    || /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(input);
}

export function normalizeDoi(rawValue) {
  let value = String(rawValue || "").trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the original value when it contains a stray percent sign.
  }
  value = value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
  const match = value.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
  if (!match) return "";
  return match[0].replace(/[.,;:]+$/, "").toLowerCase();
}

export function doiFromArticleUrl(rawValue) {
  const source = normalizePublicArticleUrl(rawValue);
  if (!source) return "";
  const url = new URL(source);
  if (/^(?:dx\.)?doi\.org$/i.test(url.hostname)) return normalizeDoi(url.pathname.slice(1));
  return normalizeDoi(`${url.pathname} ${url.search}`);
}

export function arxivHtmlUrl(rawValue) {
  const source = normalizePublicArticleUrl(rawValue);
  if (!source) return "";
  const url = new URL(source);
  if (!/(^|\.)arxiv\.org$/i.test(url.hostname)) return "";
  const match = url.pathname.match(/^\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?$/i);
  if (!match || !/^(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/i.test(match[1])) return "";
  return `https://arxiv.org/html/${match[1]}`;
}
