const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");

test("rollback authorization - block non-admin and non-reviewer roles", (t, done) => {
  const serverPath = path.join(__dirname, "..", "server", "index.js");
  const testPort = 5678;
  
  const child = spawn("node", [serverPath], {
    env: { ...process.env, PORT: String(testPort) }
  });

  let completed = false;

  child.stdout.on("data", (data) => {
    const output = data.toString();
    if (output.includes("running at") || output.includes("Social Media Guardrails Agent")) {
      // Server is ready, execute requests
      
      // Request 1: Rollback with x-role = user (Should return 403)
      const req1 = http.request({
        hostname: "localhost",
        port: testPort,
        path: "/api/audit/dummy-id/rollback",
        method: "POST",
        headers: {
          "x-role": "user"
        }
      }, (res1) => {
        assert.equal(res1.statusCode, 403);
        
        let body1 = "";
        res1.setEncoding("utf8");
        res1.on("data", chunk => body1 += chunk);
        res1.on("end", () => {
          const json1 = JSON.parse(body1);
          assert.ok(json1.error.includes("Forbidden"));

          // Request 2: Rollback with x-role = reviewer (Should return 404 since dummy-id is fake, bypassing 403!)
          const req2 = http.request({
            hostname: "localhost",
            port: testPort,
            path: "/api/audit/dummy-id/rollback",
            method: "POST",
            headers: {
              "x-role": "reviewer"
            }
          }, (res2) => {
            assert.equal(res2.statusCode, 404);
            
            let body2 = "";
            res2.setEncoding("utf8");
            res2.on("data", chunk => body2 += chunk);
            res2.on("end", () => {
              child.kill();
              completed = true;
              done();
            });
          });
          req2.end();
        });
      });
      req1.end();
    }
  });

  child.on("error", (err) => {
    child.kill();
    if (!completed) done(err);
  });

  setTimeout(() => {
    if (!completed) {
      child.kill();
      done(new Error("Server rollback test timed out."));
    }
  }, 5000);
});

test("rollback authorization - enforce secret token verification when secrets are active", (t, done) => {
  const serverPath = path.join(__dirname, "..", "server", "index.js");
  const testPort = 5679;
  const testSecret = "test-reviewer-secret";
  
  const child = spawn("node", [serverPath], {
    env: { ...process.env, PORT: String(testPort), TRUSTED_REVIEWER_SECRET: testSecret }
  });

  let completed = false;

  child.stdout.on("data", (data) => {
    const output = data.toString();
    if (output.includes("running at") || output.includes("Social Media Guardrails Agent")) {
      // Server is ready, execute requests
      
      // Request 1: Rollback with x-role = reviewer but NO secret header (Should return 403)
      const req1 = http.request({
        hostname: "localhost",
        port: testPort,
        path: "/api/audit/dummy-id/rollback",
        method: "POST",
        headers: {
          "x-role": "reviewer"
        }
      }, (res1) => {
        assert.equal(res1.statusCode, 403);
        
        let body1 = "";
        res1.setEncoding("utf8");
        res1.on("data", chunk => body1 += chunk);
        res1.on("end", () => {
          const json1 = JSON.parse(body1);
          assert.ok(json1.error.includes("Forbidden"));

          // Request 2: Rollback with x-role = reviewer and correct secret header (Should return 404)
          const req2 = http.request({
            hostname: "localhost",
            port: testPort,
            path: "/api/audit/dummy-id/rollback",
            method: "POST",
            headers: {
              "x-role": "reviewer",
              "x-reviewer-secret": testSecret
            }
          }, (res2) => {
            assert.equal(res2.statusCode, 404);
            
            let body2 = "";
            res2.setEncoding("utf8");
            res2.on("data", chunk => body2 += chunk);
            res2.on("end", () => {
              child.kill();
              completed = true;
              done();
            });
          });
          req2.end();
        });
      });
      req1.end();
    }
  });

  child.on("error", (err) => {
    child.kill();
    if (!completed) done(err);
  });

  setTimeout(() => {
    if (!completed) {
      child.kill();
      done(new Error("Server rollback secret test timed out."));
    }
  }, 5000);
});

