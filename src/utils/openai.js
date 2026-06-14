const https = require("node:https");

function callAzureOpenAi(messages, options = {}) {
  return new Promise((resolve, reject) => {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-mini";
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview";

    if (!endpoint || !apiKey) {
      reject(new Error("Azure OpenAI keys or endpoints are not configured."));
      return;
    }

    let cleanEndpoint = endpoint.trim();
    if (cleanEndpoint.endsWith("/")) {
      cleanEndpoint = cleanEndpoint.slice(0, -1);
    }

    if (!cleanEndpoint.startsWith("http://") && !cleanEndpoint.startsWith("https://")) {
      cleanEndpoint = "https://" + cleanEndpoint;
    }

    const url = `${cleanEndpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      reject(new Error(`Invalid Azure OpenAI endpoint URL: ${url}`));
      return;
    }

    const payload = JSON.stringify({
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1000,
      response_format: options.responseFormat || { type: "text" }
    });

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: options.timeout ?? 8000
    };

    const req = https.request(reqOptions, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Azure OpenAI call failed with status ${res.statusCode}: ${body}`));
          return;
        }
        try {
          const result = JSON.parse(body);
          resolve(result);
        } catch (err) {
          reject(new Error(`Failed to parse Azure OpenAI JSON response: ${body}`));
        }
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Azure OpenAI request timed out."));
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  callAzureOpenAi
};
