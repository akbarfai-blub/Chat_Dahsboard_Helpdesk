// P0.5 controlled logout-failure simulation proxy (NO secrets).
// Listens on :54389, proxies everything to real local Supabase (default 127.0.0.1:54321)
// EXCEPT POST /auth/v1/logout, which returns HTTP 500 while the mode file says "fail".
// Mode file: "p05-fail-mode" (content "fail" or "pass") next to this script, read per request.
// This reaches the REAL Server Action -> signOut code path with a genuine Supabase-level error.
// Env: P05_PROXY_UPSTREAM (default http://127.0.0.1:54321), P05_PROXY_PORT (default 54389).
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UPSTREAM = process.env.P05_PROXY_UPSTREAM || "http://127.0.0.1:54321";
const LISTEN = Number(process.env.P05_PROXY_PORT || 54389);
const modeFile = fileURLToPath(new URL("./p05-fail-mode", import.meta.url));

function failMode() {
  try {
    return readFileSync(modeFile, "utf8").trim() === "fail";
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  const target = new URL(req.url, UPSTREAM);
  const isLogout = req.method === "POST" && target.pathname.startsWith("/auth/v1/logout");

  if (isLogout && failMode()) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: 500, msg: "Internal Server Error (simulated logout failure)" }));
    return;
  }

  const proxy = http.request(
    UPSTREAM + req.url,
    { method: req.method, headers: { ...req.headers, host: new URL(UPSTREAM).host } },
    (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    },
  );
  proxy.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: 502, msg: "proxy upstream unreachable" }));
  });
  req.pipe(proxy);
});

server.listen(LISTEN, "127.0.0.1", () => {
  console.log(`P05_FAIL_PROXY listening on ${LISTEN} -> ${UPSTREAM}; mode=${failMode() ? "fail" : "pass"}`);
});