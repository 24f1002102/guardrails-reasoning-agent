const https = require("node:https");

function searchWeb(query) {
  return new Promise((resolve) => {
    if (!query || typeof query !== "string" || !query.trim()) {
      resolve([]);
      return;
    }

    const cleanQuery = encodeURIComponent(query.trim());
    const url = `https://html.duckduckgo.com/html/?q=${cleanQuery}`;
    
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      resolve([]);
      return;
    }

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      },
      timeout: 1200
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const results = [];
        // Regex to match anything with a class containing "snippet"
        const matches = body.matchAll(/class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|td|div)>/gi);
        
        for (const match of matches) {
          let snippet = match[1].replace(/<[^>]*>/g, "").trim();
          // Unescape HTML entities
          snippet = snippet
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#x27;/g, "'")
            .replace(/&#39;/g, "'");
          
          if (snippet && snippet.length > 15 && !results.includes(snippet)) {
            results.push(snippet);
          }
          if (results.length >= 3) break;
        }

        // Fallback: if class-based matching failed, try matching broad result text blocks
        if (results.length === 0) {
          const textMatches = body.matchAll(/<td class="result-snippet">([\s\S]*?)<\/td>/gi);
          for (const match of textMatches) {
            let snippet = match[1].replace(/<[^>]*>/g, "").trim();
            snippet = snippet
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#x27;/g, "'")
              .replace(/&#39;/g, "'");
            if (snippet && snippet.length > 15) {
              results.push(snippet);
            }
            if (results.length >= 3) break;
          }
        }

        resolve(results);
      });
    });

    req.on("error", () => {
      resolve([]);
    });

    req.on("timeout", () => {
      req.destroy();
      resolve([]);
    });

    req.end();
  });
}

module.exports = {
  searchWeb
};
