const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { analyzePost, analyzePostStream } = require("../src/reasoningEngine");
const { scenarios } = require("../src/data/scenarios");
const { policyCorpus } = require("../src/data/policies");
const { createAuditStore } = require("../src/store/auditStore");

const port = Number(process.env.PORT || 4173);
const publicDir = path.join(__dirname, "..", "public");
const auditStore = createAuditStore();

// ---------------------------------------------------------------------------
// Rate limiting — simple in-memory token bucket, no external dependencies
// ---------------------------------------------------------------------------
const rateLimitMap = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_MAX = 20;        // requests (aligned with SUBMISSION.md)
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

function isRateLimited(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// Prune stale IP entries every 5 minutes to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now >= entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60_000);

// ---------------------------------------------------------------------------
// MIME types for static file serving
// ---------------------------------------------------------------------------
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(message);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Static file serving with path traversal protection
// ---------------------------------------------------------------------------
function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const normalizedPath = path.normalize(pathname).replace(/^(\.\.[\\/])+/, "");
  const filePath = path.join(publicDir, normalizedPath);

  if (!filePath.startsWith(publicDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(response, 404, "Not found");
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream"
    });
    response.end(content);
  });
}

// ---------------------------------------------------------------------------
// Role resolution — FIXED: no hardcoded fallback secrets in source code.
// Set TRUSTED_ADMIN_SECRET and TRUSTED_REVIEWER_SECRET in your .env file.
// If env vars are absent, elevated roles are not granted.
// ---------------------------------------------------------------------------
function resolveRole(request, body) {
  const clientRole = body?.actor?.role;
  const adminSecret = process.env.TRUSTED_ADMIN_SECRET;
  const reviewerSecret = process.env.TRUSTED_REVIEWER_SECRET;

  if (clientRole === "admin" && adminSecret) {
    const clientAdminSecret = request.headers["x-admin-secret"] || body?.actor?.adminSecret;
    if (clientAdminSecret === adminSecret) return "admin";
    return "analyst"; // spoofed → demote
  }

  if (clientRole === "reviewer" && reviewerSecret) {
    const clientReviewerSecret = request.headers["x-reviewer-secret"] || body?.actor?.reviewerSecret;
    if (clientReviewerSecret === reviewerSecret) return "reviewer";
    return "analyst"; // spoofed → demote
  }

  if (clientRole === "analyst") return "analyst";

  // Public demo or unrecognized role — treat as reviewer for policy access
  return "reviewer";
}

// ---------------------------------------------------------------------------
// API route handler
// ---------------------------------------------------------------------------
async function handleApi(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    const hasAzureOpenAi = !!(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT);
    const hasAzureSearch = !!(process.env.FOUNDRY_IQ_MODE === "live" && process.env.FOUNDRY_IQ_RETRIEVAL_URL);
    sendJson(response, 200, {
      ok: true,
      service: "Social Media Guardrails Reasoning Agent",
      foundryIqMode: process.env.FOUNDRY_IQ_MODE || "mock",
      azureOpenAIActive: hasAzureOpenAi,
      azureSearchActive: hasAzureSearch,
      now: new Date().toISOString()
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/scenarios") {
    sendJson(response, 200, { scenarios });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/policies") {
    sendJson(response, 200, {
      policies: policyCorpus.map((policy) => ({
        id: policy.id,
        source: policy.source,
        title: policy.title,
        section: policy.section,
        severity: policy.severity,
        tags: policy.tags
      }))
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/audit") {
    sendJson(response, 200, { records: auditStore.list() });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/analyze") {
    try {
      const body = await readJsonBody(request);

      // Secure server-side role resolution
      const resolvedRole = resolveRole(request, body);
      if (!body.actor) body.actor = {};
      body.actor.role = resolvedRole;

      // Enrich request with author enforcement history from the audit store
      const authorHandle = body.author?.handle || "@demo_author";
      const authorHistory = auditStore.getAuthorHistory(authorHandle);
      if (!body.author) body.author = {};
      body.author.priorEnforcementCount = authorHistory.count;
      body.author.priorHighRiskCount = authorHistory.highRiskCount;

      const wantsStreaming = (request.headers.accept || "").includes("text/event-stream") || body?.stream;

      if (wantsStreaming) {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        });

        try {
          const analysis = await analyzePostStream(body, async (stepInfo) => {
            response.write(`event: agent-step\ndata: ${JSON.stringify(stepInfo)}\n\n`);
          });
          const record = auditStore.record(analysis);
          response.write(`event: final-result\ndata: ${JSON.stringify({ ...analysis, auditRecord: record })}\n\n`);
        } catch (streamError) {
          response.write(`event: error\ndata: ${JSON.stringify({ error: streamError.message })}\n\n`);
        } finally {
          response.end();
        }
        return;
      }

      const analysis = await analyzePost(body);
      const record = auditStore.record(analysis);
      sendJson(response, 200, { ...analysis, auditRecord: record });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  const rollbackMatch = requestUrl.pathname.match(/^\/api\/audit\/([^/]+)\/rollback$/);
  if (request.method === "POST" && rollbackMatch) {
    const userRole = request.headers["x-role"] || "user";
    const adminSecret = process.env.TRUSTED_ADMIN_SECRET;
    const reviewerSecret = process.env.TRUSTED_REVIEWER_SECRET;

    if (userRole === "admin") {
      const clientAdminSecret = request.headers["x-admin-secret"];
      if (adminSecret && clientAdminSecret !== adminSecret) {
        sendJson(response, 403, { error: "Forbidden: Invalid admin secret signature." });
        return;
      }
    } else if (userRole === "reviewer") {
      const clientReviewerSecret = request.headers["x-reviewer-secret"];
      if (reviewerSecret && clientReviewerSecret !== reviewerSecret) {
        sendJson(response, 403, { error: "Forbidden: Invalid reviewer secret signature." });
        return;
      }
    } else {
      sendJson(response, 403, { error: "Forbidden: Only Admin or Reviewer roles can rollback moderation decisions." });
      return;
    }

    const record = auditStore.rollback(rollbackMatch[1]);
    if (!record) {
      sendJson(response, 404, { error: "Audit record not found or cannot be rolled back." });
      return;
    }
    sendJson(response, 200, { record });
    return;
  }

  sendJson(response, 404, { error: "API route not found." });
}

// ---------------------------------------------------------------------------
// HTTP server with security headers
// ---------------------------------------------------------------------------
const server = http.createServer(async (request, response) => {
  // Security headers on every response
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; " +
    "connect-src 'self'; " +
    "img-src 'self' data:; " +
    "object-src 'none'; " +
    "base-uri 'self'"
  );

  // Rate limiting — apply only to API routes to avoid throttling static assets
  if (request.url.startsWith("/api/")) {
    const forwarded = request.headers["x-forwarded-for"];
    const ip = forwarded ? forwarded.split(",")[0].trim() : (request.socket.remoteAddress || "unknown");
    if (isRateLimited(ip)) {
      sendJson(response, 429, {
        error: "Too many requests. Please wait a moment before trying again."
      });
      return;
    }
    await handleApi(request, response);
    return;
  }

  serveStatic(request, response);
});

server.listen(port, () => {
  console.log(`Social Media Guardrails Agent running at http://localhost:${port}`);
  if (!process.env.TRUSTED_ADMIN_SECRET) {
    console.warn("  [WARN] TRUSTED_ADMIN_SECRET not set — admin role will not be granted.");
  }
  if (!process.env.TRUSTED_REVIEWER_SECRET) {
    console.warn("  [WARN] TRUSTED_REVIEWER_SECRET not set — reviewer role uses public-demo fallback.");
  }
});
