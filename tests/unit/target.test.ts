import { describe, expect, it } from "vitest";
import { parseHostnameSlug, parseTarget } from "@/lib/target";

function ok(input: string) {
  const r = parseTarget(input);
  if (!r.ok) throw new Error(`expected ok for ${input}, got ${r.error}`);
  return r.target;
}

function err(input: string) {
  const r = parseTarget(input);
  if (r.ok) throw new Error(`expected error for ${input}`);
  return r.error;
}

describe("parseTarget", () => {
  it("accepts bare domains and defaults to https", () => {
    expect(ok("example.com")).toMatchObject({ hostname: "example.com", protocol: "https", port: 443, path: "/", url: "https://example.com/" });
  });

  it("normalises case, whitespace and trailing dot", () => {
    expect(ok("  HTTPS://Example.COM./  ").url).toBe("https://example.com/");
  });

  it("keeps http, path and query", () => {
    expect(ok("http://example.com/a/b?x=1&y=2")).toMatchObject({ protocol: "http", port: 80, path: "/a/b", query: "x=1&y=2" });
  });

  it("drops fragments", () => {
    expect(ok("https://example.com/page#section").url).toBe("https://example.com/page");
  });

  it("converts IDN to punycode", () => {
    expect(ok("https://münchen.de").hostname).toBe("xn--mnchen-3ya.de");
  });

  it("accepts host:port with the default port", () => {
    expect(ok("example.com:443").url).toBe("https://example.com/");
    expect(ok("http://example.com:80").url).toBe("http://example.com/");
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["ftp://example.com", "unsupported_protocol"],
    ["javascript:alert(1)", "unsupported_protocol"],
    ["mailto:someone@example.com", "unsupported_protocol"],
    ["file:///etc/passwd", "unsupported_protocol"],
    ["https://user:pass@example.com", "credentials_not_allowed"],
    ["https://127.0.0.1", "ip_not_allowed"],
    ["http://169.254.169.254/latest/meta-data", "ip_not_allowed"],
    ["http://2130706433", "ip_not_allowed"], // decimal form of 127.0.0.1
    ["http://0x7f000001", "ip_not_allowed"],
    ["http://[::1]/", "ip_not_allowed"],
    ["https://example.com:8443", "port_not_allowed"],
    ["http://example.com:22", "port_not_allowed"],
    ["https://example.com:80", "port_not_allowed"],
    ["localhost", "invalid_hostname"],
    ["localhost:3000", "port_not_allowed"],
    ["intranet", "invalid_hostname"],
    ["foo.localhost", "reserved_hostname"],
    ["printer.local", "reserved_hostname"],
    ["db.internal", "reserved_hostname"],
    ["something.onion", "reserved_hostname"],
    ["1.1.1.1.in-addr.arpa", "reserved_hostname"],
    ["-bad-.com", "invalid_hostname"],
    ["exa mple.com", "invalid_url"],
    ["example.123", "invalid_url"], // WHATWG URL rejects numeric TLDs
    [`${"a".repeat(64)}.com`, "invalid_hostname"],
    [`https://example.com/${"a".repeat(1100)}`, "too_long"],
    ["x".repeat(3000), "too_long"],
  ])("rejects %j as %s", (input, expected) => {
    expect(err(input)).toBe(expected);
  });
});

describe("parseHostnameSlug", () => {
  it("accepts canonical and non-canonical hostnames", () => {
    expect(parseHostnameSlug("example.com")).toBe("example.com");
    expect(parseHostnameSlug("Example.COM")).toBe("example.com");
    expect(parseHostnameSlug("xn--mnchen-3ya.de")).toBe("xn--mnchen-3ya.de");
    expect(parseHostnameSlug(encodeURIComponent("münchen.de"))).toBe("xn--mnchen-3ya.de");
  });

  it("rejects paths, invalid encodings and non-domains", () => {
    expect(parseHostnameSlug("example.com%2Fpath")).toBeNull();
    expect(parseHostnameSlug("%E0%A4%A")).toBeNull();
    expect(parseHostnameSlug("127.0.0.1")).toBeNull();
    expect(parseHostnameSlug("localhost")).toBeNull();
  });
});
