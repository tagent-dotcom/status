import { describe, expect, it } from "vitest";
import { clientIp, hashIp } from "@/lib/client-ip";
import { expandIPv6 } from "@/lib/ip";

describe("clientIp", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1", "x-real-ip": "garbage" });

  it("ignores forwarding headers unless trusted", () => {
    expect(clientIp(headers, false)).toBeNull();
  });

  it("uses the first valid candidate when trusted", () => {
    expect(clientIp(headers, true)).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "cf-connecting-ip": "2001:db8::5" }), true)).toBe("2001:db8::5");
    expect(clientIp(new Headers({ "x-forwarded-for": "not-an-ip" }), true)).toBeNull();
  });
});

describe("hashIp", () => {
  it("is stable, secret-dependent and does not reveal the IP", () => {
    const a = hashIp("203.0.113.9", "secret-one-123456");
    expect(a).toBe(hashIp("203.0.113.9", "secret-one-123456"));
    expect(a).not.toBe(hashIp("203.0.113.9", "secret-two-123456"));
    expect(a).not.toContain("203");
  });

  it("groups IPv6 addresses by /64 regardless of spelling", () => {
    const s = "secret-one-123456";
    expect(hashIp("2001:db8:1:2::1", s)).toBe(hashIp("2001:0db8:0001:0002:ffff::9", s));
    expect(hashIp("2001:db8:1:2::1", s)).not.toBe(hashIp("2001:db8:1:3::1", s));
  });
});

describe("expandIPv6", () => {
  it.each([
    ["::1", "0000:0000:0000:0000:0000:0000:0000:0001"],
    ["2001:db8::", "2001:0db8:0000:0000:0000:0000:0000:0000"],
    ["::ffff:1.2.3.4", "0000:0000:0000:0000:0000:ffff:0102:0304"],
    ["fe80::1%eth0", "fe80:0000:0000:0000:0000:0000:0000:0001"],
    ["1:2:3:4:5:6:7:8", "0001:0002:0003:0004:0005:0006:0007:0008"],
  ])("%s", (input, expected) => expect(expandIPv6(input)).toBe(expected));

  it("rejects non-IPv6", () => {
    expect(expandIPv6("1.2.3.4")).toBeNull();
    expect(expandIPv6("nope")).toBeNull();
  });
});
