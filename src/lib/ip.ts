import { BlockList, isIP } from "node:net";

// Address ranges that are never a legitimate public website. Used for two things:
//  1. SSRF safety: refuse targets whose DNS points into private/internal space.
//  2. Diagnosis: an ISP resolver answering with one of these (0.0.0.0, 127.0.0.1, 10.x...) is
//     the classic signature of DNS-based blocking.
const nonPublic = new BlockList();

const v4Ranges: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"; 0.0.0.0 is a common sinkhole answer
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // deprecated 6to4 relay
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];
for (const [net, prefix] of v4Ranges) nonPublic.addSubnet(net, prefix, "ipv4");

const v6Ranges: Array<[string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard-only
  ["2001::", 23], // IETF protocol assignments (incl. Teredo)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4: embeds an arbitrary IPv4, refuse outright
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];
// IPv4-mapped addresses (::ffff:0:0/96) are deliberately absent: BlockList also matches plain
// IPv4 input against mapped IPv6 rules, which would flag every IPv4 address. Mapped and NAT64
// addresses are instead unwrapped and checked against the IPv4 list (see embeddedIPv4).
for (const [net, prefix] of v6Ranges) nonPublic.addSubnet(net, prefix, "ipv6");

/** Extracts the IPv4 address embedded in an IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::/96) IPv6 address. */
function embeddedIPv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/**
 * Compresses an IPv6 address to its canonical form (0:0:0:0:0:ffff:7f00:1 -> ::ffff:7f00:1)
 * using the WHATWG URL parser, so embedded-IPv4 detection can't be dodged by spelling.
 */
function canonicalIPv6(address: string): string {
  try {
    return new URL(`http://[${address}]/`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return address;
  }
}

/**
 * True when `address` is a syntactically valid IP that is routable on the public internet.
 * Anything unparseable returns false, so callers fail closed.
 */
export function isPublicIp(address: string): boolean {
  const trimmed = address.trim().replace(/^\[|\]$/g, "");
  // Strip an IPv6 zone id (fe80::1%eth0); zoned addresses are link-local anyway.
  const withoutZone = trimmed.split("%")[0];
  const family = isIP(withoutZone);
  if (family === 4) return !nonPublic.check(withoutZone, "ipv4");
  if (family === 6) {
    const v4 = embeddedIPv4(canonicalIPv6(withoutZone));
    if (v4 !== null) return isIP(v4) === 4 && !nonPublic.check(v4, "ipv4");
    return !nonPublic.check(withoutZone, "ipv6");
  }
  return false;
}

export function isIpLiteral(value: string): boolean {
  return isIP(value.replace(/^\[|\]$/g, "")) !== 0;
}

/**
 * Fully expands an IPv6 address to 8 groups of 4 hex digits, or returns null if it isn't one.
 * Handles "::" compression and a trailing embedded IPv4 (::ffff:1.2.3.4).
 */
export function expandIPv6(address: string): string | null {
  const value = address.trim().replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (isIP(value) !== 6) return null;
  let text = value;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = tail === undefined ? headParts : [...headParts, ...Array(missing).fill("0"), ...tailParts];
  if (groups.length !== 8) return null;
  return groups.map((g) => g.padStart(4, "0")).join(":");
}
