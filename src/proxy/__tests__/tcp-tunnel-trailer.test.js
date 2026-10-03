/**
 * Integration test: CONNECT tunnel (double pipe) should preserve HTTP trailers.
 *
 * Run:
 *   npm test -- tcp-tunnel-trailer
 *   or
 *   npx jest tcp-tunnel-trailer
 */

const http = require("node:http");
const net = require("node:net");
const assert = require("node:assert");

function listen0(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function parseHttpResponse(raw) {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    throw new Error("Invalid HTTP response: no header terminator");
  }
  const headerText = raw.slice(0, headerEnd);
  const bodyText = raw.slice(headerEnd + 4);

  const lines = headerText.split("\r\n");
  const statusLine = lines.shift();
  const statusCode = parseInt(statusLine.split(" ")[1], 10);

  const headers = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    headers[key] = val;
  }

  const isChunked = /chunked/i.test(headers["transfer-encoding"] || "");
  if (!isChunked) {
    return { statusCode, headers, body: bodyText, trailers: {} };
  }

  // Minimal chunked parser with trailers
  let i = 0;
  let body = "";
  const trailers = {};

  while (true) {
    const lineEnd = bodyText.indexOf("\r\n", i);
    if (lineEnd === -1) throw new Error("Invalid chunked encoding");
    const sizeHex = bodyText.slice(i, lineEnd);
    const size = parseInt(sizeHex, 16);
    i = lineEnd + 2;

    if (size === 0) {
      // Parse trailers until empty line
      while (true) {
        const tEnd = bodyText.indexOf("\r\n", i);
        if (tEnd === -1) throw new Error("Invalid trailers");
        const tLine = bodyText.slice(i, tEnd);
        i = tEnd + 2;
        if (tLine === "") break;
        const tIdx = tLine.indexOf(":");
        if (tIdx !== -1) {
          const tKey = tLine.slice(0, tIdx).trim().toLowerCase();
          const tVal = tLine.slice(tIdx + 1).trim();
          trailers[tKey] = tVal;
        }
      }
      break;
    }

    body += bodyText.slice(i, i + size);
    i += size + 2; // skip chunk data + CRLF
  }

  return { statusCode, headers, body, trailers };
}

describe("CONNECT tunnel trailer passthrough", () => {
  test("preserves response Trailer headers", async () => {
    const upstream = http.createServer((req, res) => {
      if (req.url !== "/trailers") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/plain",
        Trailer: "X-Test-Trailer"
      });
      res.write("hello");
      res.addTrailers({ "X-Test-Trailer": "abc123" });
      res.end("world");
    });
    const upstreamPort = await listen0(upstream);

    const proxy = http.createServer();
    proxy.on("connect", (req, clientSocket, head) => {
      const [host, portStr] = req.url.split(":");
      const port = Number(portStr);
      const serverSocket = net.connect(port, host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length) serverSocket.write(head);
        clientSocket.pipe(serverSocket);
        serverSocket.pipe(clientSocket);
      });
      serverSocket.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => serverSocket.destroy());
    });
    const proxyPort = await listen0(proxy);

    try {
      const rawResponse = await new Promise((resolve, reject) => {
        const req = http.request({
          host: "127.0.0.1",
          port: proxyPort,
          method: "CONNECT",
          path: `127.0.0.1:${upstreamPort}`
        });
        req.on("connect", (res, socket, head) => {
          const chunks = [];
          if (head && head.length) chunks.push(head);

          socket.on("data", (c) => chunks.push(c));
          socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          socket.on("error", reject);

          socket.write(
            "GET /trailers HTTP/1.1\r\n" +
            "Host: 127.0.0.1\r\n" +
            "Connection: close\r\n\r\n"
          );
        });
        req.on("error", reject);
        req.end();
      });

      const parsed = parseHttpResponse(rawResponse);
      assert.strictEqual(parsed.statusCode, 200);
      assert.strictEqual(parsed.body, "helloworld");
      assert.ok(/x-test-trailer/i.test(parsed.headers.trailer || ""));
      assert.strictEqual(parsed.trailers["x-test-trailer"], "abc123");
    } finally {
      await new Promise((r) => proxy.close(r));
      await new Promise((r) => upstream.close(r));
    }
  });
});
