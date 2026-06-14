const crypto = require("node:crypto");
const { policyCorpus } = require("./data/policies");
const { searchWeb } = require("./utils/search");

const signalLexicon = {
  misinformation: [
    "no official source", "they hide it", "secret", "bury it", "unverified", "rumor",
    "fake news", "cover up", "cover-up", "they don't want you", "mainstream media",
    "suppressed", "censored truth", "whistleblower", "leaked documents", "hidden agenda",
    "not reported", "they won't show", "real truth", "what they hide"
  ],
  election: [
    "polling", "vote", "voting", "ballot", "district", "election",
    "polling place", "polling station", "voter id", "absentee", "mail-in",
    "rigged", "stolen election", "election fraud", "dead voters", "ballot dump",
    "vote count", "swing state", "electoral", "precinct", "recount"
  ],
  health: [
    "cures", "supplement", "skip doctors", "medical", "illness", "pharma",
    "miracle cure", "natural remedy", "doctors won't tell", "big pharma",
    "detox", "toxins", "immune system", "cancer cure", "avoid vaccines",
    "alternative medicine", "essential oils cure", "ivermectin", "bleach cure"
  ],
  harassment: [
    "target", "attack them", "ruin", "harass",
    "destroy them", "expose them", "make them pay", "hunt down",
    "dox", "find their address", "show up at", "coordinated report"
  ],
  privacy: [
    "phone", "address", "email", "password", "credential",
    "home address", "phone number", "social security", "ssn", "date of birth",
    "license plate", "ip address", "bank account", "credit card"
  ],
  bot: [
    "repost", "same phrase", "top of every hour", "trend", "everyone reply",
    "reply with", "copy paste", "flood the timeline", "make it trend",
    "mass report", "bot army", "automated", "script this", "scheduled post"
  ],
  promptInjection: [
    "ignore previous instructions", "reveal system", "developer message", "tool call",
    "forget your instructions", "new instructions", "system prompt", "jailbreak",
    "override safety", "bypass filter", "act as", "pretend you are", "disregard"
  ]
};

const amplificationLexicon = {
  emotionalIntensity: [
    "breaking", "urgent", "shocking", "everyone", "repost", "share", "before they hide", "bury it",
    "must see", "you need to know", "share immediately", "going viral", "spread this",
    "wake up", "red alert", "emergency", "act now", "time sensitive"
  ],
  novelty: [
    "secret", "no official source", "unverified", "leaked", "hidden",
    "exclusive", "first to report", "breaking exclusive", "insider", "whistleblower",
    "classified", "unreported", "suppressed", "they don't want"
  ],
  polarization: [
    "they hide", "bury it", "everyone needs", "before they", "attack", "scam",
    "deep state", "globalists", "cabal", "elites", "mainstream won't", "wake up sheeple",
    "us vs them", "the real enemy", "traitors", "corrupt"
  ]
};

const actionCatalog = [
  {
    id: "allow",
    label: "Allow",
    restrictionCost: 5,
    description: "Leave the post normally distributed."
  },
  {
    id: "context_label",
    label: "Context Label",
    restrictionCost: 18,
    description: "Add neutral context without slowing distribution."
  },
  {
    id: "source_required_and_label",
    label: "Require Source",
    restrictionCost: 34,
    description: "Ask for a credible source and show a context label."
  },
  {
    id: "throttle_and_context_label",
    label: "Throttle Reach",
    restrictionCost: 52,
    description: "Limit distribution while showing a context label."
  },
  {
    id: "human_review",
    label: "Human Review",
    restrictionCost: 48,
    description: "Route the post to a trained reviewer before stronger action."
  },
  {
    id: "human_review_and_trend_pause",
    label: "Trend Pause + Review",
    restrictionCost: 66,
    description: "Pause trend eligibility and route to human review."
  },
  {
    id: "emergency_containment",
    label: "Emergency Containment",
    restrictionCost: 90,
    description: "Contain immediately and escalate to trained reviewers."
  }
];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRequest(input = {}) {
  const postText = String(input.postText || "").trim();
  if (postText.length < 8) {
    throw new Error("Post text must contain at least 8 characters.");
  }

  return {
    postText,
    author: {
      handle: String(input.author?.handle || "@demo_author"),
      accountAgeDays: toNumber(input.author?.accountAgeDays, 180),
      followerCount: toNumber(input.author?.followerCount, 1000),
      verified: Boolean(input.author?.verified),
      priorViolations: toNumber(input.author?.priorViolations, 0),
      // Enriched by server from audit store history
      priorEnforcementCount: Math.max(0, toNumber(input.author?.priorEnforcementCount, 0)),
      priorHighRiskCount: Math.max(0, toNumber(input.author?.priorHighRiskCount, 0))
    },
    metrics: {
      minutesSincePosted: Math.max(1, toNumber(input.metrics?.minutesSincePosted, 60)),
      likes: Math.max(0, toNumber(input.metrics?.likes, 0)),
      shares: Math.max(0, toNumber(input.metrics?.shares, 0)),
      replies: Math.max(0, toNumber(input.metrics?.replies, 0)),
      reports: Math.max(0, toNumber(input.metrics?.reports, 0))
    },
    context: {
      topic: String(input.context?.topic || "general"),
      eventWindow: String(input.context?.eventWindow || "normal"),
      region: String(input.context?.region || "demo-region"),
      language: String(input.context?.language || "en"),
      mediaType: String(input.context?.mediaType || "text"),
      synchronizedSignals: Boolean(input.context?.synchronizedSignals)
    },
    actor: {
      role: String(input.actor?.role || "public-demo")
    }
  };
}

/**
 * Compute a coarse reach tier from follower count + share velocity.
 * Included in the idempotency postVersion hash so the same post at dramatically
 * different engagement scales triggers a fresh decision rather than replaying
 * the low-reach result.
 *   "low"    — followerCount < 10k  AND shares < 500
 *   "medium" — followerCount < 100k AND shares < 5000
 *   "high"   — anything larger
 */
function computeReachTier(request) {
  const followers = request.author.followerCount;
  const shares = request.metrics.shares;
  if (followers < 10_000 && shares < 500) return "low";
  if (followers < 100_000 && shares < 5_000) return "medium";
  return "high";
}

function stableHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function normalizeText(text) {
  let normalized = text.toLowerCase();
  normalized = normalized.replace(/0/g, "o");
  normalized = normalized.replace(/1/g, "i");
  normalized = normalized.replace(/3/g, "e");
  normalized = normalized.replace(/4/g, "a");
  normalized = normalized.replace(/@/g, "a");
  normalized = normalized.replace(/!/g, "i");
  normalized = normalized.replace(/5/g, "s");
  normalized = normalized.replace(/\$/g, "s");
  return normalized;
}

function findMatches(text, terms) {
  const lower = text.toLowerCase();
  const normalizedText = normalizeText(lower);
  return terms.filter((term) => {
    const lowerTerm = term.toLowerCase();
    const normalizedTerm = normalizeText(lowerTerm);
    return lower.includes(lowerTerm) || normalizedText.includes(normalizedTerm);
  });
}

function riskBand(score) {
  if (score >= 80) return "High";
  if (score >= 50) return "Medium";
  if (score >= 25) return "Guarded";
  return "Low";
}

function severityLabel(severity) {
  if (severity >= 88) return "Critical";
  if (severity >= 76) return "High";
  if (severity >= 55) return "Medium";
  return "Low";
}

function analyzeContentSignals(request, webCitations = []) {
  const categories = Object.entries(signalLexicon)
    .map(([category, terms]) => {
      const matches = findMatches(request.postText, terms);
      if (!matches.length) {
        return null;
      }
      const baseSeverity = {
        misinformation: 60,
        election: 72,
        health: 70,
        harassment: 67,
        privacy: 74,
        bot: 58,
        promptInjection: 80
      }[category];
      return {
        category,
        severity: clamp(baseSeverity + matches.length * 5),
        confidence: clamp(45 + matches.length * 16, 45, 92),
        evidence: matches.slice(0, 4)
      };
    })
    .filter(Boolean);

  const privateDataPattern = /([\w.-]+@[\w.-]+\.[a-z]{2,})|(\+?\d[\d\s().-]{7,}\d)/i;
  if (privateDataPattern.test(request.postText)) {
    categories.push({
      category: "privacy",
      severity: 90,
      confidence: 88,
      evidence: ["private contact pattern"]
    });
  }

  const topicBoost =
    request.context.topic === "election" || request.context.topic === "health" || request.context.topic === "public-safety"
      ? 14
      : 0;

  const webMatches = [];
  webCitations.forEach((snippet) => {
    const matches = findMatches(snippet, ["rumor", "rumour", "affair", "leak", "unverified", "fake", "speculation", "arrest", "scam", "fraud"]);
    if (matches.length) {
      webMatches.push(...matches);
    }
  });

  if (webMatches.length) {
    categories.push({
      category: "misinformation",
      severity: 68,
      confidence: 85,
      evidence: ["live web search matches: " + [...new Set(webMatches)].slice(0, 3).join(", ")]
    });
  }

  const priorBoost = clamp(request.author.priorViolations * 6, 0, 30);
  // Repeat-offender boost: escalate if this author has prior enforcements in the audit store
  const repeatOffenderBoost = clamp(
    request.author.priorEnforcementCount * 3 + request.author.priorHighRiskCount * 5,
    0,
    25
  );
  const contentRisk = clamp(
    categories.reduce((sum, item) => sum + item.severity * (item.confidence / 100), 0) /
      Math.max(1, categories.length) +
      topicBoost +
      priorBoost +
      repeatOffenderBoost
  );

  return {
    agent: "content-signal-agent",
    riskScore: round(contentRisk),
    confidence: round(
      categories.reduce((max, item) => Math.max(max, item.confidence), categories.length ? 45 : 72)
    ),
    categories,
    summary:
      categories.length === 0
        ? "No high-risk text signals were detected in the local lexicon."
        : `${categories.length} risk category signal(s) detected from content and context.`,
    repeatOffenderSignal: request.author.priorEnforcementCount > 0
      ? `Author has ${request.author.priorEnforcementCount} prior enforcement record(s) including ${request.author.priorHighRiskCount} high-risk decision(s).`
      : null,
    safeguards: [
      "Treats the post as untrusted user-generated content.",
      "Does not allow post text to override system or policy instructions.",
      "Uses synthetic demo policy data unless live Foundry IQ is configured."
    ]
  };
}

function assessAmplificationRisk(request, contentSignals) {
  const minutes = request.metrics.minutesSincePosted;
  const engagementVelocity =
    (request.metrics.likes + request.metrics.shares * 3 + request.metrics.replies * 1.2 + request.metrics.reports * 2) /
    minutes;
  const sharePressure = request.metrics.shares / Math.max(1, request.metrics.likes);
  const followerReach = Math.log10(Math.max(10, request.author.followerCount)) * 12;
  const activeEventBoost = request.context.eventWindow === "active" ? 12 : 0;
  const unverifiedPenalty = request.author.verified ? -5 : 7;

  const emotionalMatches = findMatches(request.postText, amplificationLexicon.emotionalIntensity);
  const noveltyMatches = findMatches(request.postText, amplificationLexicon.novelty);
  const polarizationMatches = findMatches(request.postText, amplificationLexicon.polarization);

  const topicSensitivity = {
    election: request.context.eventWindow === "active" ? 96 : 84,
    health: 78,
    "public-safety": 84,
    product: 18,
    general: 30
  }[request.context.topic] || 30;

  const factorScores = [
    {
      label: "Emotional intensity",
      score: round(clamp(emotionalMatches.length * 24 + (request.metrics.shares > 500 ? 18 : 0))),
      evidence: emotionalMatches.length ? emotionalMatches.slice(0, 4) : ["no strong urgency language"]
    },
    {
      label: "Engagement velocity",
      score: round(clamp(45 * Math.log10(1 + engagementVelocity / 20))),
      evidence: [`${round(engagementVelocity, 2)} weighted engagements per minute`]
    },
    {
      label: "Topic sensitivity",
      score: topicSensitivity,
      evidence: [`topic:${request.context.topic}`, `event window:${request.context.eventWindow}`]
    },
    {
      label: "Novelty or source uncertainty",
      score: round(clamp(noveltyMatches.length * 30 + unverifiedPenalty * 3 + (contentSignals.riskScore > 60 ? 10 : 0))),
      evidence: noveltyMatches.length ? noveltyMatches.slice(0, 4) : ["no novelty claim detected"]
    },
    {
      label: "Polarization pressure",
      score: round(clamp(polarizationMatches.length * 28 + Math.min(18, request.metrics.reports / 4))),
      evidence: polarizationMatches.length ? polarizationMatches.slice(0, 4) : ["low conflict language"]
    },
    {
      label: "Network reach",
      score: round(clamp(followerReach + activeEventBoost + (request.author.verified ? -6 : 4))),
      evidence: [`${request.author.followerCount.toLocaleString()} followers`]
    }
  ];

  const amplificationRisk = clamp(
    factorScores[0].score * 0.16 +
      factorScores[1].score * 0.28 +
      factorScores[2].score * 0.2 +
      factorScores[3].score * 0.16 +
      factorScores[4].score * 0.12 +
      factorScores[5].score * 0.08
  );

  const baselineReach = Math.max(100, request.author.followerCount * 0.025 + engagementVelocity * 240);
  const normalReachTwoHours = Math.round(baselineReach * (1 + amplificationRisk / 70));
  const riskAdjustedReachTwoHours = Math.round(normalReachTwoHours * (1 + contentSignals.riskScore / 120));

  return {
    agent: "amplification-risk-agent",
    riskScore: round(amplificationRisk),
    riskBand: riskBand(amplificationRisk),
    engagementVelocity: round(engagementVelocity, 2),
    sharePressure: round(sharePressure, 2),
    normalReachTwoHours,
    riskAdjustedReachTwoHours,
    factorScores,
    confidence: round(clamp(50 + Math.min(35, minutes / 3) + Math.min(10, request.metrics.reports / 10))),
    uncertainty:
      "Amplification risk is a decision-support estimate based on observed factors, not a factual prediction of future reach."
  };
}

function simulateBotAmplification(request, amplificationRisk, contentSignals) {
  const shareLikeRatio = request.metrics.shares / Math.max(1, request.metrics.likes);
  const youngAccountScore = request.author.accountAgeDays < 30 ? 88 : request.author.accountAgeDays < 90 ? 58 : 20;
  const synchronizedScore = request.context.synchronizedSignals ? 92 : 18;
  const repeatedPhraseScore = contentSignals.categories.some((item) => item.category === "bot") ? 86 : 16;
  const velocityScore = amplificationRisk.engagementVelocity > 120 ? 88 : amplificationRisk.engagementVelocity > 40 ? 58 : 22;
  const sharePressureScore = shareLikeRatio > 2 ? 90 : shareLikeRatio > 0.8 ? 62 : 24;
  const reportScore = request.metrics.reports > 50 ? 80 : request.metrics.reports > 15 ? 54 : 14;

  const riskFactors = [
    {
      label: "Synchronized engagement",
      score: synchronizedScore,
      evidence: request.context.synchronizedSignals ? "coordination flag present" : "no synchronized flag"
    },
    {
      label: "Repost density",
      score: sharePressureScore,
      evidence: `${round(shareLikeRatio, 2)} shares per like`
    },
    {
      label: "Follower anomalies",
      score: youngAccountScore,
      evidence: `${request.author.accountAgeDays} day old account`
    },
    {
      label: "Coordinated timing",
      score: repeatedPhraseScore,
      evidence: repeatedPhraseScore > 60 ? "coordination language detected" : "no explicit timing language"
    },
    {
      label: "Engagement spikes",
      score: velocityScore,
      evidence: `${amplificationRisk.engagementVelocity} weighted engagements per minute`
    },
    {
      label: "Report pressure",
      score: reportScore,
      evidence: `${request.metrics.reports} user reports`
    }
  ];

  const coordinationRisk = clamp(
    riskFactors[0].score * 0.22 +
      riskFactors[1].score * 0.18 +
      riskFactors[2].score * 0.16 +
      riskFactors[3].score * 0.2 +
      riskFactors[4].score * 0.16 +
      riskFactors[5].score * 0.08
  );
  const amplifiedReachThirtyMinutes = Math.round(
    amplificationRisk.riskAdjustedReachTwoHours * (0.35 + coordinationRisk / 85)
  );

  const factors = riskFactors.filter((factor) => factor.score >= 50).map((factor) => factor.label.toLowerCase());

  return {
    agent: "coordination-simulation-agent",
    riskScore: round(coordinationRisk),
    riskBand: riskBand(coordinationRisk),
    amplifiedReachThirtyMinutes,
    simulatedConditions: {
      coordinatedAccounts: Math.round(12 + coordinationRisk * 1.8),
      repostBurstMinutes: coordinationRisk > 70 ? 8 : coordinationRisk > 45 ? 18 : 45,
      networkClusters: coordinationRisk > 70 ? 5 : coordinationRisk > 45 ? 3 : 1
    },
    riskFactors,
    factors: factors.length ? factors : ["no strong coordination signal"],
    recommendation:
      coordinationRisk >= 60
        ? "Treat reach as potentially manipulated until a reviewer validates the engagement pattern."
        : "Do not assume manipulation, but preserve the signal in the audit record."
  };
}

function tokenizeForPolicy(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 3);
}

function scorePolicy(policy, request, contentSignals, botSimulation) {
  const terms = new Set([
    ...tokenizeForPolicy(request.postText),
    request.context.topic.toLowerCase(),
    ...contentSignals.categories.map((item) => item.category),
    ...(botSimulation.riskScore > 45 ? ["bot", "coordinated", "amplification"] : []),
    ...(contentSignals.riskScore > 45 ? ["transparency", "audit"] : [])
  ]);

  const tagMatches = policy.tags.filter((tag) => terms.has(tag) || terms.has(tag.replace("-", "")));
  const textMatches = policy.tags.filter((tag) => request.postText.toLowerCase().includes(tag));
  const topicMatch = policy.tags.includes(request.context.topic.toLowerCase()) ? 2 : 0;
  return tagMatches.length * 20 + textMatches.length * 8 + topicMatch * 10 + policy.severity / 10;
}

async function retrievePolicyCitations(request, contentSignals, amplificationRisk, botSimulation) {
  const liveUrl = process.env.FOUNDRY_IQ_RETRIEVAL_URL;
  const liveMode = (process.env.FOUNDRY_IQ_MODE || "mock").toLowerCase() === "live";

  if (liveMode && liveUrl) {
    const isAzureSearch = liveUrl.includes(".search.windows.net");
    const queryText = [
      request.postText,
      `topic:${request.context.topic}`,
      `contentRisk:${contentSignals.riskScore}`,
      `amplificationRisk:${amplificationRisk.riskScore}`,
      `coordinationRisk:${botSimulation.riskScore}`
    ].join("\n");

    const headers = {
      "Content-Type": "application/json"
    };

    if (isAzureSearch) {
      if (process.env.FOUNDRY_IQ_API_KEY) {
        headers["api-key"] = process.env.FOUNDRY_IQ_API_KEY;
      }
    } else {
      if (process.env.FOUNDRY_IQ_API_KEY) {
        headers["x-api-key"] = process.env.FOUNDRY_IQ_API_KEY;
      }
      if (process.env.FOUNDRY_IQ_BEARER_TOKEN) {
        headers.Authorization = `Bearer ${process.env.FOUNDRY_IQ_BEARER_TOKEN}`;
      }
    }

    const bodyPayload = isAzureSearch
      ? {
          search: queryText,
          top: 5
        }
      : {
          query: queryText,
          context: {
            role: request.actor.role,
            region: request.context.region,
            language: request.context.language
          },
          retrievalReasoningEffort: "medium",
          outputMode: "extractiveData"
        };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(liveUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyPayload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Foundry IQ retrieval failed with status ${response.status}.`);
      }
      const payload = await response.json();
      return normalizeLiveFoundryResponse(payload, isAzureSearch);
    } catch (error) {
      clearTimeout(timeoutId);
      return localPolicyRetrieval(request, contentSignals, botSimulation, {
        mode: "live-fallback-to-local",
        warning: error.message,
        isFallback: true
      });
    }
  }

  return localPolicyRetrieval(request, contentSignals, botSimulation, {
    mode: "local-policy-corpus",
    isFallback: false
  });
}

function normalizeLiveFoundryResponse(payload, isAzureSearch = false) {
  const rawItems = Array.isArray(payload.citations)
    ? payload.citations
    : Array.isArray(payload.results)
      ? payload.results
      : Array.isArray(payload.value)
        ? payload.value
        : [];

  const citations = rawItems.slice(0, 5).map((item, index) => {
    const severity = clamp(Number(item.severity || 75));
    const rawScore = item["@search.score"] || item.score || item.confidence || 0.72;
    let confidence = 75;

    if (isAzureSearch && item["@search.score"] != null) {
      // Map raw Azure Search relevance score (typically 0.2 to 3.0) to a clean 45%-96% percentage
      confidence = clamp(Math.round((item["@search.score"] / 2.5) * 100), 45, 96);
    } else {
      confidence = clamp(Math.round(Number(rawScore) * (rawScore <= 1.0 ? 100 : 1)), 20, 100);
    }

    return {
      id: item.id || item.documentId || `LIVE-${index + 1}`,
      source: item.source || item.sourceName || item.metadata_storage_name || (isAzureSearch ? "Azure AI Search Index" : "Foundry IQ knowledge base"),
      title: item.title || item.name || item.filename || item.metadata_title || "Retrieved policy",
      section: item.section || item.chunkId || item.section_name || "retrieved",
      excerpt: item.excerpt || item.content || item.text || item.content_snippet || item.snippet || "Retrieved extractive policy content.",
      objective: item.objective || null,
      confidence: round(confidence),
      severity,
      severityLabel: severityLabel(severity),
      retrievalReason: isAzureSearch
        ? `Relevance search score: ${round(item["@search.score"] || 0, 2)}`
        : "Returned by configured Foundry IQ retrieval endpoint."
    };
  });

  return {
    agent: "foundry-iq-policy-agent",
    retrievalMode: isAzureSearch ? "live-azure-search" : "live-foundry-iq",
    retrievalStatus: isAzureSearch ? "live-azure-search" : "live-foundry-iq",
    groundingConfidence: citations.length ? citations[0].confidence : 80,
    uncertaintyReason: null,
    summary: isAzureSearch
      ? "Retrieved policy evidence from a live Azure AI Search Index."
      : "Retrieved policy evidence from the configured Foundry IQ knowledge base endpoint.",
    citations,
    permissionStatus: isAzureSearch
      ? "Delegated to Azure query key search permissions."
      : "Delegated to configured knowledge base permissions.",
    warning: citations.length ? null : "Live retrieval returned no citations. Enforcement will escalate uncertainty."
  };
}

function localPolicyRetrieval(request, contentSignals, botSimulation, options) {
  const scored = policyCorpus
    .filter((policy) => policy.allowedRoles.includes(request.actor.role))
    .map((policy) => ({
      policy,
      score: scorePolicy(policy, request, contentSignals, botSimulation)
    }))
    .filter((item) => item.score >= 20)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  const isFallback = !!options.isFallback;

  const citations = scored.map(({ policy, score }) => {
    let confidence = round(clamp(score, 35, 96));
    if (isFallback) {
      confidence = round(clamp(confidence * 0.45, 20, 45));
    }
    return {
      id: policy.id,
      source: policy.source,
      title: policy.title,
      section: policy.section,
      excerpt: policy.excerpt,
      objective: policy.objective || null,
      confidence,
      severity: policy.severity,
      severityLabel: severityLabel(policy.severity),
      retrievalReason: `Matched tags: ${policy.tags
        .filter((tag) => request.postText.toLowerCase().includes(tag) || tag === request.context.topic)
        .slice(0, 4)
        .join(", ") || "risk category alignment"}`
    };
  });

  if (citations.length === 0) {
    let defaultConf = 42;
    if (isFallback) {
      defaultConf = 25;
    }
    citations.push({
      id: "POL-TRANS-006",
      source: "Synthetic Transparency and Appeals Standard",
      title: "Explainable Enforcement",
      section: "7.2",
      excerpt:
        "Every automated intervention must include the least restrictive action selected, policy citations, uncertainty level, an audit identifier, and a route for human appeal or rollback.",
      objective: "Ensure Proportionality, Transparency & Reviewer Appeals",
      confidence: defaultConf,
      severity: 72,
      severityLabel: "Medium",
      retrievalReason: "Default transparency citation because no high-confidence policy matched."
    });
  }

  return {
    agent: "foundry-iq-policy-agent",
    retrievalMode: options.mode,
    retrievalStatus: isFallback ? "fallback" : "local-mock",
    groundingConfidence: isFallback ? 35 : (citations[0]?.confidence || 72),
    uncertaintyReason: isFallback ? "Live policy retrieval unavailable. Using fallback corpus." : null,
    summary: isFallback
      ? "Live policy retrieval unavailable. Using fallback corpus."
      : "Retrieved extractive policy evidence from a local synthetic knowledge base that mirrors the Foundry IQ contract for demo mode.",
    citations,
    permissionStatus:
      "Local demo enforced role filtering against policy metadata. Configure live Foundry IQ for document-level permissions.",
    warning: options.warning || null
  };
}

function calculatePolicySeverity(foundryIq) {
  return (
    foundryIq.citations.reduce((max, citation) => Math.max(max, citation.severity * (citation.confidence / 100)), 0) || 0
  );
}

function calculateGovernanceRisk(contentSignals, amplificationRisk, botSimulation, foundryIq) {
  const policySeverity = calculatePolicySeverity(foundryIq);
  return clamp(
    contentSignals.riskScore * 0.28 +
      amplificationRisk.riskScore * 0.28 +
      botSimulation.riskScore * 0.2 +
      policySeverity * 0.24
  );
}

function scoreAlternativeActions(request, contentSignals, amplificationRisk, botSimulation, foundryIq) {
  const governanceRisk = calculateGovernanceRisk(contentSignals, amplificationRisk, botSimulation, foundryIq);
  const policyConfidence = foundryIq.citations[0]?.confidence || 0;
  const sensitiveTopic = ["election", "health", "public-safety"].includes(request.context.topic);
  const severeContent = contentSignals.categories.some((item) => ["privacy", "harassment"].includes(item.category));

  const rawScores = {
    allow: clamp(100 - governanceRisk * 1.2 - contentSignals.riskScore * 0.35 - amplificationRisk.riskScore * 0.22),
    context_label: clamp(55 - Math.abs(governanceRisk - 35) * 0.55 + contentSignals.riskScore * 0.12 + policyConfidence * 0.1),
    source_required_and_label: clamp(
      40 +
        contentSignals.riskScore * 0.22 +
        policyConfidence * 0.22 +
        (sensitiveTopic ? 14 : 0) -
        botSimulation.riskScore * 0.06
    ),
    throttle_and_context_label: clamp(
      26 +
        amplificationRisk.riskScore * 0.32 +
        botSimulation.riskScore * 0.18 +
        contentSignals.riskScore * 0.15 +
        policyConfidence * 0.12
    ),
    human_review: clamp(
      24 +
        governanceRisk * 0.32 +
        (100 - policyConfidence) * 0.2 +
        contentSignals.riskScore * 0.14 +
        botSimulation.riskScore * 0.1
    ),
    human_review_and_trend_pause: clamp(
      18 +
        amplificationRisk.riskScore * 0.3 +
        botSimulation.riskScore * 0.2 +
        contentSignals.riskScore * 0.18 +
        policyConfidence * 0.13 +
        (sensitiveTopic ? 8 : 0)
    ),
    emergency_containment: clamp(
      (governanceRisk >= 88 ? 38 : 4) +
        (severeContent ? 28 : 0) +
        contentSignals.riskScore * 0.16 +
        botSimulation.riskScore * 0.1 +
        amplificationRisk.riskScore * 0.1 -
        12
    )
  };

  const candidates = actionCatalog.map((action) => {
    const safetyGain = round(rawScores[action.id]);
    const policyFit = round(
      clamp(
        policyConfidence * 0.45 +
          calculatePolicySeverity(foundryIq) * 0.28 +
          (sensitiveTopic ? 8 : 0) +
          (action.id === "allow" ? -20 : 0)
      )
    );
    const overallScore = round(clamp(safetyGain * 0.72 + policyFit * 0.22 - action.restrictionCost * 0.08));
    return {
      ...action,
      safetyGain,
      policyFit,
      score: overallScore,
      selected: false,
      rationale: buildActionRationale(action.id, governanceRisk, amplificationRisk, botSimulation, policyConfidence)
    };
  });

  const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
  const minimumRestriction =
    governanceRisk >= 82 ? 48 : governanceRisk >= 66 ? 34 : governanceRisk >= 45 ? 18 : 0;
  const margin = governanceRisk >= 82 ? 3 : governanceRisk >= 66 ? 5 : 8;
  const effectiveOptions = candidates
    .filter((candidate) => candidate.score >= bestScore - margin && candidate.restrictionCost >= minimumRestriction)
    .sort((left, right) => left.restrictionCost - right.restrictionCost || right.score - left.score);

  const selected = effectiveOptions[0] || candidates.sort((left, right) => right.score - left.score)[0];
  candidates.forEach((candidate) => {
    candidate.selected = candidate.id === selected.id;
  });

  return {
    governanceRisk: round(governanceRisk),
    selectionRule: "Select the least restrictive action whose score is close to the strongest safety option.",
    candidates: candidates.sort((left, right) => right.score - left.score),
    selected
  };
}

function buildActionRationale(actionId, governanceRisk, amplificationRisk, botSimulation, policyConfidence) {
  const rationale = {
    allow: "Appropriate only when governance risk and policy concern are low.",
    context_label: "Adds transparency when risk exists but distribution control is not yet justified.",
    source_required_and_label: "Best when factual certainty is disputed and citations support source friction.",
    throttle_and_context_label: "Best when amplification risk is high and the system can reduce reach without removal.",
    human_review: "Best when uncertainty remains and a trained reviewer should resolve context.",
    human_review_and_trend_pause: "Best when amplification risk and coordination risk make trend exposure unsafe.",
    emergency_containment: "Reserved for critical risk where immediate containment is safer than waiting."
  }[actionId];

  return `${rationale} Inputs: governance ${round(governanceRisk)}%, amplification ${round(
    amplificationRisk.riskScore
  )}%, coordination ${round(botSimulation.riskScore)}%, policy confidence ${round(policyConfidence)}%.`;
}

function decideEnforcement(request, contentSignals, amplificationRisk, botSimulation, foundryIq, actionAnalysis) {
  let selected = actionAnalysis.selected;
  const isFallback = foundryIq.retrievalStatus === "fallback";

  if (isFallback) {
    // Escalate to human review only if governance risk is elevated (>= 50%)
    if (actionAnalysis.governanceRisk >= 50) {
      selected =
        actionAnalysis.candidates.find((candidate) => candidate.id === "human_review") ||
        actionAnalysis.selected;
    }
  } else {
    // Normal rule: if no reliable citation (confidence >= 50) and governance risk is elevated (>= 45), route to human review
    const hasReliableCitation = foundryIq.citations.some((citation) => citation.confidence >= 50);
    if (!hasReliableCitation && actionAnalysis.governanceRisk >= 45) {
      selected =
        actionAnalysis.candidates.find((candidate) => candidate.id === "human_review") ||
        actionAnalysis.selected;
    }
  }

  const severity =
    actionAnalysis.governanceRisk >= 88
      ? "critical"
      : actionAnalysis.governanceRisk >= 66
        ? "high"
        : actionAnalysis.governanceRisk >= 35
          ? "medium"
          : "low";

  // Include reachTier in postVersion so the same post at viral scale
  // is not deduplicated against its earlier low-reach decision.
  const reachTier = computeReachTier(request);
  const postVersion = stableHash({
    postText: request.postText,
    authorHandle: request.author.handle,
    topic: request.context.topic,
    region: request.context.region,
    language: request.context.language,
    mediaType: request.context.mediaType,
    reachTier
  }).slice(0, 16);
  const idempotencyKey = stableHash({ postVersion, action: selected.id }).slice(0, 24);
  const publicExplanation = buildPublicExplanation(selected, foundryIq.citations, actionAnalysis.governanceRisk);

  return {
    agent: "guardrail-enforcement-agent",
    action: selected.id,
    actionLabel: selected.label,
    severity,
    riskScore: actionAnalysis.governanceRisk,
    confidence: round(
      clamp(44 + foundryIq.citations[0].confidence * 0.28 + selected.score * 0.22 + Math.min(12, amplificationRisk.confidence / 8))
    ),
    postVersion,
    idempotencyKey,
    rollbackAvailable: !["allow", "emergency_containment"].includes(selected.id),
    publicExplanation,
    selectedAlternative: selected,
    internalControls: [
      "Idempotency key prevents duplicate enforcement for the same post version.",
      "Decision is deterministic for the same input and policy evidence.",
      "High-risk or low-citation cases route to human review instead of autonomous removal."
    ]
  };
}

function buildPublicExplanation(selected, citations, governanceRisk) {
  const primaryCitation = citations[0];
  const actionText = {
    allow: "The post can remain normally distributed.",
    context_label: "The post should receive a context label.",
    source_required_and_label: "The post should require a credible source and receive a context label.",
    throttle_and_context_label: "Distribution should be throttled while a context label is shown.",
    human_review: "The post should be routed to human review because policy grounding is uncertain.",
    human_review_and_trend_pause: "The post should be routed to human review and paused from trend eligibility.",
    emergency_containment: "The post should be contained immediately and escalated to trained reviewers."
  }[selected.id];

  return `${actionText} Governance risk is ${round(governanceRisk)}%. The selected action scored ${selected.score}% as the least restrictive effective option, grounded in ${primaryCitation.title} section ${primaryCitation.section}.`;
}

function buildGovernanceDeliberation(contentSignals, amplificationRisk, botSimulation, foundryIq, actionAnalysis, enforcement) {
  const policyConfidence = foundryIq.citations[0]?.confidence || 0;
  const factualCertainty =
    contentSignals.riskScore >= 70 && policyConfidence >= 70
      ? "policy evidence and content signals align"
      : "signals disagree on factual certainty";
  const amplificationConsensus =
    amplificationRisk.riskScore >= 65 || botSimulation.riskScore >= 65
      ? "agents agree amplification exposure is the primary safety risk"
      : "agents do not see strong amplification pressure";

  return {
    agent: "governance-deliberation-agent",
    summary: `${factualCertainty}, but ${amplificationConsensus}.`,
    selectedAction: enforcement.action,
    selectedActionLabel: enforcement.actionLabel,
    leastRestrictiveReason: `Selected ${enforcement.actionLabel} because it had an effective safety score while avoiding stronger restrictions unless escalation is justified.`,
    positions: [
      {
        agent: "Content Agent",
        stance:
          contentSignals.riskScore >= 60
            ? "Potential harm signal detected."
            : "Low-confidence harm signal.",
        confidence: contentSignals.confidence,
        evidence: contentSignals.categories.map((item) => item.category).join(", ") || "no high-risk categories"
      },
      {
        agent: "Amplification Agent",
        stance:
          amplificationRisk.riskScore >= 70
            ? "Reach acceleration risk is high."
            : "Reach acceleration risk is limited.",
        confidence: amplificationRisk.confidence,
        evidence: amplificationRisk.factorScores
          .filter((factor) => factor.score >= 50)
          .map((factor) => factor.label)
          .join(", ") || "low factor scores"
      },
      {
        agent: "Coordination Agent",
        stance:
          botSimulation.riskScore >= 60
            ? "Coordinated amplification is plausible."
            : "Coordination confidence is limited.",
        confidence: botSimulation.riskScore,
        evidence: botSimulation.factors.join(", ")
      },
      {
        agent: "Policy Agent",
        stance:
          policyConfidence >= 70
            ? "Policy evidence supports intervention."
            : "Policy evidence supports caution and review.",
        confidence: policyConfidence,
        evidence: foundryIq.citations[0]?.title || "no citation"
      },
      {
        agent: "Governance Agent",
        stance: `Selected ${enforcement.actionLabel}.`,
        confidence: enforcement.confidence,
        evidence: actionAnalysis.selectionRule
      }
    ]
  };
}

function buildTimeline(contentSignals, amplificationRisk, botSimulation, foundryIq, governanceDeliberation, enforcement, actionAnalysis, llmDeliberated = false) {
  return [
    {
      step: 1,
      agent: "Content Signal Agent",
      status: "complete",
      score: contentSignals.riskScore,
      explanation: contentSignals.summary,
      trace: {
        finding: contentSignals.categories.length > 0
          ? `${contentSignals.categories.length} risk category signal(s) detected: ${contentSignals.categories.map(c => c.category).join(", ")}.`
          : "No high-risk text signals detected.",
        confidence: `${round(contentSignals.confidence)}%`,
        impact: contentSignals.riskScore >= 50 ? "High content safety concern." : "Low content safety concern."
      }
    },
    {
      step: 2,
      agent: "Amplification Risk Agent",
      status: "complete",
      score: amplificationRisk.riskScore,
      explanation: `Assessed ${amplificationRisk.riskBand.toLowerCase()} amplification risk using engagement velocity, topic sensitivity, novelty, and reach pressure.`,
      trace: {
        finding: `Engagement velocity: ${amplificationRisk.engagementVelocity} engagements/min. Reach band: ${amplificationRisk.riskBand}.`,
        confidence: `${round(amplificationRisk.confidence)}%`,
        impact: amplificationRisk.riskScore >= 50 ? "Potential viral spread." : "Limited spread pressure."
      }
    },
    {
      step: 3,
      agent: "Coordination Simulation Agent",
      status: "complete",
      score: botSimulation.riskScore,
      explanation: `Simulated coordinated amplification reaching ${botSimulation.amplifiedReachThirtyMinutes.toLocaleString()} projected impressions in 30 minutes.`,
      trace: {
        finding: `Coordination risk: ${botSimulation.riskBand} (${botSimulation.simulatedConditions.coordinatedAccounts} coordinated accounts).`,
        confidence: `${round(botSimulation.riskScore)}%`,
        impact: botSimulation.riskScore >= 50 ? "Suspicious coordinated engagement detected." : "Normal user distribution pattern."
      }
    },
    {
      step: 4,
      agent: "Foundry IQ Policy Agent",
      status: foundryIq.citations.length ? "complete" : "needs-review",
      score: foundryIq.citations[0]?.confidence || 0,
      explanation: foundryIq.retrievalStatus === "fallback"
        ? "Live policy retrieval unavailable. Using fallback corpus."
        : `${foundryIq.citations.length} cited policy extract(s) retrieved using ${foundryIq.retrievalMode}.`,
      trace: {
        finding: foundryIq.retrievalStatus === "fallback"
          ? "Live policy retrieval unavailable. Using fallback corpus."
          : `Retrieved ${foundryIq.citations.length} policy citation(s) from ${foundryIq.retrievalMode}.`,
        confidence: `${round(foundryIq.citations[0]?.confidence || 0)}%`,
        impact: foundryIq.citations[0] ? `Matched policy ${foundryIq.citations[0].title}.` : "No direct policy match."
      }
    },
    {
      step: 5,
      agent: "Governance Deliberation Agent",
      status: "complete",
      score: enforcement.riskScore,
      explanation: governanceDeliberation.summary,
      trace: {
        finding: governanceDeliberation.summary + (llmDeliberated ? " [Azure OpenAI GPT-4o-mini active]" : " [Mock deliberation fallback]"),
        considered: actionAnalysis.candidates.map(c => c.label).join(", "),
        selected: enforcement.actionLabel,
        reason: governanceDeliberation.leastRestrictiveReason
      }
    },
    {
      step: 6,
      agent: "Guardrail Enforcement Agent",
      status: "complete",
      score: enforcement.riskScore,
      explanation: `Selected least restrictive effective action: ${enforcement.actionLabel}.`,
      trace: {
        finding: `Enforced action: ${enforcement.actionLabel}.`,
        confidence: `${round(enforcement.confidence)}%`,
        impact: `Applied safety guardrail (idempotency key: ${enforcement.idempotencyKey.slice(0, 8)}...).`
      }
    }
  ];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function analyzePostStream(input, onStep) {
  const request = normalizeRequest(input);

  // Live web search grounding
  let webCitations = [];
  try {
    const searchQuery = request.postText.slice(0, 120);
    webCitations = await searchWeb(searchQuery);
  } catch (err) {
    // Ignore search errors
  }

  // Step 1: Content Signal Agent
  const contentSignals = analyzeContentSignals(request, webCitations);
  if (onStep) {
    await onStep({
      step: 1,
      agent: "Content Signal Agent",
      status: "complete",
      score: contentSignals.riskScore,
      explanation: contentSignals.summary,
      trace: {
        finding: contentSignals.categories.length > 0
          ? `${contentSignals.categories.length} risk category signal(s) detected: ${contentSignals.categories.map(c => c.category).join(", ")}.`
          : "No high-risk text signals detected.",
        confidence: `${round(contentSignals.confidence)}%`,
        impact: contentSignals.riskScore >= 50 ? "High content safety concern." : "Low content safety concern."
      }
    });
    await sleep(250);
  }

  // Step-2: Amplification Risk Agent
  const amplificationRisk = assessAmplificationRisk(request, contentSignals);
  if (onStep) {
    await onStep({
      step: 2,
      agent: "Amplification Risk Agent",
      status: "complete",
      score: amplificationRisk.riskScore,
      explanation: `Assessed ${amplificationRisk.riskBand.toLowerCase()} amplification risk using engagement velocity, topic sensitivity, novelty, and reach pressure.`,
      trace: {
        finding: `Engagement velocity: ${amplificationRisk.engagementVelocity} engagements/min. Reach band: ${amplificationRisk.riskBand}.`,
        confidence: `${round(amplificationRisk.confidence)}%`,
        impact: amplificationRisk.riskScore >= 50 ? "Potential viral spread." : "Limited spread pressure.",
        normalReach: amplificationRisk.normalReachTwoHours,
        riskAdjustedReach: amplificationRisk.riskAdjustedReachTwoHours
      }
    });
    await sleep(250);
  }

  // Step-3: Coordination Simulation Agent
  const botSimulation = simulateBotAmplification(request, amplificationRisk, contentSignals);
  if (onStep) {
    await onStep({
      step: 3,
      agent: "Coordination Simulation Agent",
      status: "complete",
      score: botSimulation.riskScore,
      explanation: `Simulated coordinated amplification reaching ${botSimulation.amplifiedReachThirtyMinutes.toLocaleString()} projected impressions in 30 minutes.`,
      trace: {
        finding: `Coordination risk: ${botSimulation.riskBand} (${botSimulation.simulatedConditions.coordinatedAccounts} coordinated accounts).`,
        confidence: `${round(botSimulation.riskScore)}%`,
        impact: botSimulation.riskScore >= 50 ? "Suspicious coordinated engagement detected." : "Normal user distribution pattern.",
        amplifiedReach: botSimulation.amplifiedReachThirtyMinutes
      }
    });
    await sleep(250);
  }

  // Step-4: Foundry IQ Policy Agent
  const foundryIq = await retrievePolicyCitations(request, contentSignals, amplificationRisk, botSimulation);
  if (webCitations && webCitations.length) {
    webCitations.forEach((snippet, index) => {
      foundryIq.citations.push({
        id: `WEB-SEARCH-${index + 1}`,
        source: "Live Web Search (DuckDuckGo)",
        title: `Search Grounding #${index + 1}`,
        section: "live-context",
        excerpt: snippet,
        confidence: 85,
        severity: 50,
        severityLabel: "Low",
        retrievalReason: "Real-time web grounding for content context."
      });
    });
  }
  if (onStep) {
    await onStep({
      step: 4,
      agent: "Foundry IQ Policy Agent",
      status: foundryIq.citations.length ? "complete" : "needs-review",
      score: foundryIq.citations[0]?.confidence || 0,
      explanation: foundryIq.retrievalStatus === "fallback"
        ? "Live policy retrieval unavailable. Using fallback corpus."
        : `${foundryIq.citations.length} cited policy extract(s) retrieved using ${foundryIq.retrievalMode}.`,
      trace: {
        finding: foundryIq.retrievalStatus === "fallback"
          ? "Live policy retrieval unavailable. Using fallback corpus."
          : `Retrieved ${foundryIq.citations.length} policy citation(s) from ${foundryIq.retrievalMode}.`,
        confidence: `${round(foundryIq.citations[0]?.confidence || 0)}%`,
        impact: foundryIq.citations[0] ? `Matched policy ${foundryIq.citations[0].title}.` : "No direct policy match."
      }
    });
    await sleep(250);
  }

  // Step-5: Governance Deliberation Agent
  const actionAnalysis = scoreAlternativeActions(request, contentSignals, amplificationRisk, botSimulation, foundryIq);
  let enforcement = decideEnforcement(
    request,
    contentSignals,
    amplificationRisk,
    botSimulation,
    foundryIq,
    actionAnalysis
  );
  let governanceDeliberation = buildGovernanceDeliberation(
    contentSignals,
    amplificationRisk,
    botSimulation,
    foundryIq,
    actionAnalysis,
    enforcement
  );

  let llmDeliberated = false;
  if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
    try {
      const messages = [
        {
          role: "system",
          content: `You are the Governance Deliberation Agent for a social media moderation system. Your goal is to apply the LEAST RESTRICTIVE effective action (minimizing censorship while preserving platform safety).
You must analyze the inputs and output a valid JSON object in the following format:
{
  "deliberationSummary": "Overview explaining why content signals, amplification, and policy alignment support or caution against intervention.",
  "selectedAction": "allow | context_label | source_required_and_label | throttle_and_context_label | human_review | human_review_and_trend_pause | emergency_containment",
  "leastRestrictiveReason": "Detailed reasoning demonstrating why this action is the minimum necessary enforcement compared to harsher options.",
  "governanceStance": "Summary of platform safety stance.",
  "governanceConfidence": 85
}

Enforcement Catalog:
- "allow" (cost: 5): Leave post normally distributed. Use when no clear policy violation exists.
- "context_label" (cost: 18): Add neutral context. Use for unverified claims or borderline issues.
- "source_required_and_label" (cost: 34): Add label and require source links. Use for disputed procedural/factual claims.
- "throttle_and_context_label" (cost: 52): Slow reach and add label. Use for sensitive topics spreading quickly.
- "human_review" (cost: 48): Send to human reviewer. Use when policy relevance is highly ambiguous.
- "human_review_and_trend_pause" (cost: 66): Pause trending status and send to review. Use for viral polarization or coordination risks.
- "emergency_containment" (cost: 90): Contain post immediately. Use ONLY for extreme risks (doxxing, severe harassment, public safety danger).`
        },
        {
          role: "user",
          content: JSON.stringify({
            postText: request.postText,
            context: { topic: request.context.topic, eventWindow: request.context.eventWindow },
            author: {
              followers: request.author.followerCount,
              verified: request.author.verified,
              priorEnforcementCount: request.author.priorEnforcementCount,
              priorHighRiskCount: request.author.priorHighRiskCount
            },
            metrics: request.metrics,
            signals: {
              contentRisk: contentSignals.riskScore,
              categories: contentSignals.categories,
              amplificationRisk: amplificationRisk.riskScore,
              coordinationRisk: botSimulation.riskScore
            },
            retrievedPolicies: foundryIq.citations
          })
        }
      ];

      const { callAzureOpenAi } = require("./utils/openai");
      const llmResponse = await callAzureOpenAi(messages, {
        temperature: 0.25,
        responseFormat: { type: "json_object" }
      });

      const responseText = llmResponse?.choices?.[0]?.message?.content;
      if (responseText) {
        let clean = responseText.trim();
        if (clean.startsWith("```")) {
          clean = clean.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        }
        const llmResult = JSON.parse(clean);

        const validActionIds = [
          "allow", "context_label", "source_required_and_label",
          "throttle_and_context_label", "human_review",
          "human_review_and_trend_pause", "emergency_containment"
        ];

        if (validActionIds.includes(llmResult.selectedAction)) {
          actionAnalysis.candidates.forEach(c => {
            c.selected = c.id === llmResult.selectedAction;
          });

          const selectedCandidate = actionAnalysis.candidates.find(c => c.selected);

          enforcement.action = llmResult.selectedAction;
          enforcement.actionLabel = selectedCandidate.label;
          enforcement.riskScore = actionAnalysis.governanceRisk;
          enforcement.confidence = Math.round(llmResult.governanceConfidence || 85);
          enforcement.publicExplanation = `${llmResult.leastRestrictiveReason} Grounded in ${foundryIq.citations[0]?.title || "transparency policies"}.`;
          
          governanceDeliberation.summary = llmResult.deliberationSummary;
          governanceDeliberation.leastRestrictiveReason = llmResult.leastRestrictiveReason;
          
          const govPosition = governanceDeliberation.positions.find(p => p.agent === "Governance Agent");
          if (govPosition) {
            govPosition.stance = llmResult.governanceStance;
            govPosition.confidence = enforcement.confidence;
          }

          llmDeliberated = true;
        }
      }
    } catch (err) {
      // Fallback is automatic
    }
  }

  if (onStep) {
    await onStep({
      step: 5,
      agent: "Governance Deliberation Agent",
      status: "complete",
      score: enforcement.riskScore,
      explanation: governanceDeliberation.summary,
      trace: {
        finding: governanceDeliberation.summary,
        considered: actionAnalysis.candidates.map(c => c.label).join(", "),
        selected: enforcement.actionLabel,
        reason: governanceDeliberation.leastRestrictiveReason
      }
    });
    await sleep(250);
  }

  const timeline = buildTimeline(
    contentSignals,
    amplificationRisk,
    botSimulation,
    foundryIq,
    governanceDeliberation,
    enforcement,
    actionAnalysis,
    llmDeliberated
  );

  const finalResult = {
    analysisId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    resolvedRole: request.actor.role,
    systemMode: "hybrid-ai-reasoning",
    aiLayers: {
      azureOpenAI: !!(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT),
      azureAISearch: !!(process.env.FOUNDRY_IQ_MODE === "live" && process.env.FOUNDRY_IQ_RETRIEVAL_URL)
    },
    project: {
      name: "Social Media Guardrails Reasoning Agent",
      track: "Reasoning Agents",
      iqLayer: "Foundry IQ",
      positioning:
        "Assess unsafe amplification, simulate coordinated behavior, ground decisions in policy, deliberate over alternatives, and apply proportionate guardrails."
    },
    inputSummary: {
      author: request.author.handle,
      topic: request.context.topic,
      textLength: request.postText.length,
      metrics: request.metrics,
      resolvedRole: request.actor.role
    },
    contentSignals,
    amplificationRisk,
    botSimulation,
    foundryIq,
    alternativeActions: actionAnalysis.candidates,
    governanceDeliberation,
    enforcement,
    reasoningTimeline: timeline,
    residualRisks: [
      "Amplification risk estimates are probabilistic and should not be treated as factual predictions.",
      "Local demo mode uses synthetic policy data; production deployments should use Foundry IQ with enterprise policy sources.",
      "Automated decisions should be appealable and reviewed for demographic or viewpoint bias before real deployment."
    ]
  };

  if (onStep) {
    await onStep({
      step: 6,
      agent: "Guardrail Enforcement Agent",
      status: "complete",
      score: enforcement.riskScore,
      explanation: `Selected least restrictive effective action: ${enforcement.actionLabel}.`,
      trace: {
        finding: `Enforced action: ${enforcement.actionLabel}.`,
        confidence: `${round(enforcement.confidence)}%`,
        impact: `Applied safety guardrail (idempotency key: ${enforcement.idempotencyKey.slice(0, 8)}...).`
      }
    });
  }

  return finalResult;
}

async function analyzePost(input) {
  return analyzePostStream(input);
}

module.exports = {
  analyzePost,
  analyzePostStream,
  normalizeRequest,
  analyzeContentSignals,
  assessAmplificationRisk,
  simulateBotAmplification,
  retrievePolicyCitations,
  scoreAlternativeActions,
  decideEnforcement
};
