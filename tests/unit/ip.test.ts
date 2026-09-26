import { describe, expect, it } from "vitest";
import { isPublicIp } from "@/lib/ip";

describe("isPublicIp", () => {
  it.each(["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8"])(
    "treats %s as public",
    (ip) => expect(isPublicIp(ip)).toBe(true),
  );

  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fe80::1%eth0",
    "fd00::1",
    "fc00::1",
    "ff02::1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "0:0:0:0:0:ffff:7f00:1", // expanded spelling of ::ffff:127.0.0.1
    "0000:0000:0000:0000:0000:FFFF:0A00:0001",
    "64:ff9b::a00:1",
    "[::1]",
    "not-an-ip",
    "",
    "999.1.1.1",
  ])("treats %j as non-public", (ip) => expect(isPublicIp(ip)).toBe(false));

  it("allows public IPv4 embedded in NAT64", () => {
    expect(isPublicIp("64:ff9b::808:808")).toBe(true);
  });
});
