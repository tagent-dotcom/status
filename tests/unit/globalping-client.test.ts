import { describe, expect, it } from "vitest";
import { GlobalpingClient, GlobalpingError } from "@/lib/globalping/client";

function capture(status = 202, body: unknown = { id: "abc", probesCount: 1 }) {
  const calls: Array<{ url: string; body: unknown; headers: Headers }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, client: new GlobalpingClient({ baseUrl: "https://api.test", token: "tok", fetchImpl }) };
}

describe("GlobalpingClient.createHttpMeasurement", () => {
  it("never sends empty strings (Globalping rejects them)", async () => {
    const { calls, client } = capture();
    await client.createHttpMeasurement({ hostname: "talk4now.com", protocol: "HTTPS", path: "/", query: "", locations: [{ country: "PK", limit: 2 }] });
    const request = (calls[0].body as { measurementOptions: { request: Record<string, unknown> } }).measurementOptions.request;
    expect(request).toEqual({ method: "GET", path: "/" });
    expect(Object.values(request)).not.toContain("");
    expect(calls[0].headers.get("authorization")).toBe("Bearer tok");
  });

  it("keeps a real query string", async () => {
    const { calls, client } = capture();
    await client.createHttpMeasurement({ hostname: "example.com", protocol: "HTTP", path: "/a", query: "b=1", locations: [{ country: "US", limit: 1 }] });
    expect((calls[0].body as { measurementOptions: { request: unknown } }).measurementOptions.request).toEqual({ method: "GET", path: "/a", query: "b=1" });
  });

  it("surfaces which parameter Globalping rejected", async () => {
    const { client } = capture(400, {
      error: { type: "validation_error", message: "Parameter validation failed.", params: { "measurementOptions.request.query": '"query" is not allowed to be empty' } },
    });
    const error = await client
      .createHttpMeasurement({ hostname: "example.com", protocol: "HTTPS", path: "/", query: "", locations: [{ country: "US" }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GlobalpingError);
    expect((error as Error).message).toBe('Parameter validation failed. (measurementOptions.request.query: "query" is not allowed to be empty)');
  });
});
