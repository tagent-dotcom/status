// Local stand-in for https://api.globalping.io, for development and end-to-end tests.
//   npx tsx scripts/mock-globalping.ts            (port 4010, measurements take 4s)
//   MOCK_PORT=5000 MOCK_DURATION_MS=0 npx tsx scripts/mock-globalping.ts
// Point the app at it with GLOBALPING_API_URL=http://127.0.0.1:4010.
// Scenarios are picked by hostname; see tests/fixtures/fake-network.ts.
import { createServer } from "node:http";
import { FakeNetwork } from "../tests/fixtures/fake-network";

const port = Number(process.env.MOCK_PORT ?? 4010);
const network = new FakeNetwork(Number(process.env.MOCK_DURATION_MS ?? 4000));

const server = createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  const response = await network.fetch(`http://mock${req.url ?? "/"}`, {
    method: req.method,
    body: body.length > 0 ? body : undefined,
  });
  res.writeHead(response.status, { "Content-Type": "application/json" });
  res.end(await response.text());
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock Globalping API listening on http://127.0.0.1:${port}`);
});
