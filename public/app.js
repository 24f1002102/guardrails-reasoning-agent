const state = {
  scenarios: [],
  latestAnalysis: null,
  simulation: null,
  uiQueue: [],
  isPlaying: false,
  renderLoopActive: false,
  pendingFinalResult: null,
  tempReach: { normal: null, risky: null, bot: null },
  animationFrameId: null,
  reachAnimationId: null,
  activeScenarioAuthor: null  // populated by applyScenario; null when user types freely
};

const fields = {
  scenarioSelect: document.querySelector("#scenarioSelect"),
  postText: document.querySelector("#postText"),
  topic: document.querySelector("#topic"),
  eventWindow: document.querySelector("#eventWindow"),
  followerCount: document.querySelector("#followerCount"),
  accountAgeDays: document.querySelector("#accountAgeDays"),
  likes: document.querySelector("#likes"),
  shares: document.querySelector("#shares"),
  replies: document.querySelector("#replies"),
  reports: document.querySelector("#reports"),
  minutesSincePosted: document.querySelector("#minutesSincePosted"),
  analyzeButton: document.querySelector("#analyzeButton"),
  refreshAudit: document.querySelector("#refreshAudit")
};

const output = {
  decisionPill: document.querySelector("#decisionPill"),
  contentScore: document.querySelector("#contentScore"),
  contentBand: document.querySelector("#contentBand"),
  amplificationScore: document.querySelector("#amplificationScore"),
  amplificationBand: document.querySelector("#amplificationBand"),
  coordinationScore: document.querySelector("#coordinationScore"),
  coordinationBand: document.querySelector("#coordinationBand"),
  governanceScore: document.querySelector("#governanceScore"),
  governanceBand: document.querySelector("#governanceBand"),
  publicExplanation: document.querySelector("#publicExplanation"),
  amplificationFactors: document.querySelector("#amplificationFactors"),
  botFactors: document.querySelector("#botFactors"),
  deliberationSummary: document.querySelector("#deliberationSummary"),
  alternatives: document.querySelector("#alternatives"),
  timeline: document.querySelector("#timeline"),
  citations: document.querySelector("#citations"),
  retrievalMode: document.querySelector("#retrievalMode"),
  auditList: document.querySelector("#auditList"),
  reachCanvas: document.querySelector("#reachCanvas"),
  botCanvas: document.querySelector("#botCanvas")
};

function numberValue(element) {
  return Number(element.value || 0);
}

function setNumber(element, value) {
  element.value = Number(value || 0);
}

function percent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed with status ${response.status}.`);
  }
  return response.json();
}

function applyScenario(scenario) {
  fields.postText.value = scenario.postText;
  fields.topic.value = scenario.context.topic;
  fields.eventWindow.value = scenario.context.eventWindow;
  setNumber(fields.followerCount, scenario.author.followerCount);
  setNumber(fields.accountAgeDays, scenario.author.accountAgeDays);
  setNumber(fields.likes, scenario.metrics.likes);
  setNumber(fields.shares, scenario.metrics.shares);
  setNumber(fields.replies, scenario.metrics.replies);
  setNumber(fields.reports, scenario.metrics.reports);
  setNumber(fields.minutesSincePosted, scenario.metrics.minutesSincePosted);
  // Preserve author fields that have no DOM input so buildPayload can pass them correctly.
  state.activeScenarioAuthor = {
    handle: scenario.author.handle,
    verified: scenario.author.verified ?? false,
    priorViolations: scenario.author.priorViolations ?? 0
  };
  updateCoordSignalsDisplay();
}

function buildPayload() {
  // Use scenario author metadata when a preset is active; fall back to safe defaults
  // for freely-typed posts. state.activeScenarioAuthor is set by applyScenario().
  const sa = state.activeScenarioAuthor;
  return {
    postText: fields.postText.value,
    author: {
      handle: sa?.handle ?? "@demo_author",
      accountAgeDays: numberValue(fields.accountAgeDays),
      followerCount: numberValue(fields.followerCount),
      verified: sa?.verified ?? false,
      priorViolations: sa?.priorViolations ?? 0
    },
    metrics: {
      minutesSincePosted: numberValue(fields.minutesSincePosted),
      likes: numberValue(fields.likes),
      shares: numberValue(fields.shares),
      replies: numberValue(fields.replies),
      reports: numberValue(fields.reports)
    },
    context: {
      topic: fields.topic.value,
      eventWindow: fields.eventWindow.value,
      region: "demo-region",
      language: "en",
      mediaType: "text",
      synchronizedSignals: computeCoordinationSignals().length >= 2
    },
    actor: {
      role: "public-demo"
    }
  };
}

function computeCoordinationSignals() {
  const shares = numberValue(fields.shares);
  const likes = numberValue(fields.likes);
  const replies = numberValue(fields.replies);
  const reports = numberValue(fields.reports);
  const minutes = Math.max(1, numberValue(fields.minutesSincePosted));
  const accountAgeDays = numberValue(fields.accountAgeDays);
  const followerCount = numberValue(fields.followerCount);

  const signals = [];

  const shareLikeRatio = shares / Math.max(1, likes);
  if (shareLikeRatio > 3) {
    signals.push({ label: `Share-to-like ratio: ${shareLikeRatio.toFixed(1)}x (abnormal)`, severity: "high" });
  } else if (shareLikeRatio > 1.8) {
    signals.push({ label: `Elevated share ratio: ${shareLikeRatio.toFixed(1)}x`, severity: "medium" });
  }

  const shareVelocity = shares / minutes;
  if (shareVelocity > 80) {
    signals.push({ label: `Share burst: ${Math.round(shareVelocity)}/min`, severity: "high" });
  } else if (shareVelocity > 30) {
    signals.push({ label: `Share velocity: ${Math.round(shareVelocity)}/min`, severity: "medium" });
  }

  if (accountAgeDays > 0 && accountAgeDays < 30) {
    signals.push({ label: `${accountAgeDays}-day-old account`, severity: "high" });
  } else if (accountAgeDays >= 30 && accountAgeDays < 90) {
    signals.push({ label: `New account: ${accountAgeDays} days old`, severity: "medium" });
  }

  if (reports > 50) {
    signals.push({ label: `Mass report pressure: ${reports} reports`, severity: "high" });
  } else if (reports > 20) {
    signals.push({ label: `Elevated reports: ${reports}`, severity: "medium" });
  }

  if (shares > 300 && replies < shares * 0.04) {
    signals.push({ label: `Reply suppression (${replies} replies / ${shares} shares)`, severity: "medium" });
  }

  if (followerCount > 15000 && accountAgeDays > 0 && accountAgeDays < 120) {
    signals.push({ label: `Follower anomaly: ${followerCount.toLocaleString()} on ${accountAgeDays}-day account`, severity: "medium" });
  }

  return signals;
}

function updateCoordSignalsDisplay() {
  const list = document.querySelector("#coordSignalsList");
  if (!list) return;
  const signals = computeCoordinationSignals();

  if (signals.length === 0) {
    list.innerHTML = `<span class="coord-signal-empty">No coordination signals detected</span>`;
    return;
  }

  list.innerHTML = signals
    .map(s => `<span class="coord-signal-badge ${s.severity}">${escapeHtml(s.label)}</span>`)
    .join("");
}

function severityClass(score) {
  if (score >= 75) return "danger";
  if (score >= 45) return "warning";
  return "safe";
}

function getRiskBandInfo(score) {
  if (score >= 80) return { label: "High Risk", className: "danger" };
  if (score >= 50) return { label: "Medium Risk", className: "warning" };
  if (score >= 25) return { label: "Guarded", className: "guarded" };
  return { label: "Low Risk", className: "low" };
}

function updateScoreBandElement(element, score) {
  if (!element) return;
  const info = getRiskBandInfo(score);
  element.textContent = info.label;
  element.className = `score-band ${info.className}`;
}

function renderAnalysis(analysis) {
  state.latestAnalysis = analysis;
  output.decisionPill.textContent = analysis.enforcement.actionLabel || analysis.enforcement.action.replaceAll("_", " ");
  output.decisionPill.className = `decision-pill ${severityClass(analysis.enforcement.riskScore)}`;
  animateNumber(output.contentScore, analysis.contentSignals.riskScore);
  updateScoreBandElement(output.contentBand, analysis.contentSignals.riskScore);
  animateNumber(output.amplificationScore, analysis.amplificationRisk.riskScore);
  updateScoreBandElement(output.amplificationBand, analysis.amplificationRisk.riskScore);
  animateNumber(output.coordinationScore, analysis.botSimulation.riskScore);
  updateScoreBandElement(output.coordinationBand, analysis.botSimulation.riskScore);
  animateNumber(output.governanceScore, analysis.enforcement.riskScore);
  updateScoreBandElement(output.governanceBand, analysis.enforcement.riskScore);
  output.publicExplanation.textContent = analysis.enforcement.publicExplanation;
  output.retrievalMode.textContent = analysis.foundryIq.retrievalMode;

  renderFactors(output.amplificationFactors, analysis.amplificationRisk.factorScores, "Amplification factors");
  renderFactors(output.botFactors, analysis.botSimulation.riskFactors, "Coordination factors");
  renderAlternatives(analysis.alternativeActions);
  renderTimeline(analysis.reasoningTimeline);
  renderCitations(analysis.foundryIq.citations);

  animateReachChart(
    analysis.amplificationRisk.normalReachTwoHours,
    analysis.amplificationRisk.riskAdjustedReachTwoHours,
    analysis.botSimulation.amplifiedReachThirtyMinutes
  );
  // Note: drawBotCanvas is not called here to avoid resetting the animated simulation graph
}

function renderFactors(container, factors, title) {
  container.innerHTML = `
    <h4>${escapeHtml(title)}</h4>
    ${factors
      .slice(0, 6)
      .map(
        (factor) => `
          <div class="factor-row">
            <span>${escapeHtml(factor.label)}</span>
            <strong>${percent(factor.score)}</strong>
          </div>
        `
      )
      .join("")}
  `;
}

function renderAlternatives(alternatives) {
  output.alternatives.innerHTML = alternatives
    .map(
      (action) => `
        <article class="alternative-row ${action.selected ? "selected" : ""}">
          <div class="alternative-main">
            <div>
              <h3>${escapeHtml(action.label)}</h3>
              <p>${escapeHtml(action.description)}</p>
            </div>
            <strong>${percent(action.score)}</strong>
          </div>
          <div class="score-bar" aria-label="${escapeHtml(action.label)} score ${percent(action.score)}">
            <span style="width: ${Math.round(action.score)}%"></span>
          </div>
          <div class="meta-line">
            <span>Safety gain ${percent(action.safetyGain)}</span>
            <span>Policy fit ${percent(action.policyFit)}</span>
            <span>Restriction ${percent(action.restrictionCost)}</span>
            ${action.selected ? "<span>Selected</span>" : ""}
          </div>
        </article>
      `
    )
    .join("");
}

function renderTimeline(timeline) {
  output.timeline.innerHTML = "";
  timeline.forEach((item) => {
    const row = document.createElement("li");
    row.className = "timeline-item";
    let traceHtml = "";
    if (item.trace) {
      traceHtml = `
        <div class="timeline-trace" style="margin-top: 8px; border-top: 1px dashed var(--line); padding-top: 8px; font-size: 0.85rem; color: #cbd5e1;">
          ${item.trace.finding ? `<div style="margin-bottom: 4px;"><strong>↓ Finding:</strong> ${escapeHtml(item.trace.finding)}</div>` : ""}
          ${item.trace.confidence ? `<div style="margin-bottom: 4px;"><strong>Confidence:</strong> ${escapeHtml(item.trace.confidence)}</div>` : ""}
          ${item.trace.impact ? `<div style="margin-bottom: 4px;"><strong>Impact:</strong> ${escapeHtml(item.trace.impact)}</div>` : ""}
          ${item.trace.considered ? `<div style="margin-bottom: 4px;"><strong>Considered:</strong> ${escapeHtml(item.trace.considered)}</div>` : ""}
          ${item.trace.selected ? `<div style="margin-bottom: 4px;"><strong>Selected:</strong> ${escapeHtml(item.trace.selected)}</div>` : ""}
          ${item.trace.reason ? `<div style="margin-bottom: 4px;"><strong>Reason:</strong> ${escapeHtml(item.trace.reason)}</div>` : ""}
        </div>
      `;
    }
    row.innerHTML = `
      <strong>${escapeHtml(item.step)}. ${escapeHtml(item.agent)}</strong>
      <p style="margin: 4px 0 6px;">${escapeHtml(item.explanation)}</p>
      <span>Status: ${escapeHtml(item.status)} | Score: ${percent(item.score)}</span>
      ${traceHtml}
    `;
    output.timeline.append(row);
  });
}

function renderCitations(citations) {
  output.citations.innerHTML = "";
  citations.forEach((citation) => {
    const block = document.createElement("article");
    block.className = "citation";

    let retrievalHtml = "";
    if (citation.retrievalReason) {
      const reason = citation.retrievalReason;
      const tagMatch = reason.match(/Matched tags:\s*(.+)/i);
      if (tagMatch && tagMatch[1].trim()) {
        const tags = tagMatch[1].split(",").map(t => t.trim()).filter(Boolean);
        retrievalHtml = `
          <div class="retrieval-reason">
            <span class="retrieval-reason-label">⤷ Why this policy?</span>
            <div class="retrieval-tags">
              ${tags.map(tag => `<span class="retrieval-tag">${escapeHtml(tag)}</span>`).join("")}
            </div>
          </div>
        `;
      } else {
        retrievalHtml = `
          <div class="retrieval-reason">
            <span class="retrieval-reason-label">⤷ Why this policy?</span>
            <p class="retrieval-reason-text">${escapeHtml(reason)}</p>
          </div>
        `;
      }
    }

    const objectiveHtml = citation.objective 
      ? `<div class="citation-objective" style="margin: -6px 0 10px; font-size: 0.8rem; font-weight: 700; color: var(--accent); letter-spacing: 0.01em;">🎯 Objective: ${escapeHtml(citation.objective)}</div>`
      : "";

    block.innerHTML = `
      <h3>${escapeHtml(citation.title)}</h3>
      ${objectiveHtml}
      <p>${escapeHtml(citation.excerpt)}</p>
      <div class="badge-row">
        <span>Confidence ${percent(citation.confidence)}</span>
        <span>Severity ${escapeHtml(citation.severityLabel || "Medium")}</span>
      </div>
      ${retrievalHtml}
      <div class="meta-line">
        <span>${escapeHtml(citation.source.replace(/^Synthetic\s+/i, ""))}</span>
        <span>Section ${escapeHtml(citation.section)}</span>
      </div>
    `;
    output.citations.append(block);
  });
}


function setupCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const logicalWidth = canvas.clientWidth || 420;
  const logicalHeight = canvas.clientHeight || 240;

  canvas.width = logicalWidth * dpr;
  canvas.height = logicalHeight * dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  return { width: logicalWidth, height: logicalHeight };
}

function animateNumber(element, endValue, duration = 400) {
  if (!element) return;
  const startText = element.textContent || "";
  const startValue = startText.includes("%") ? (parseInt(startText) || 0) : 0;
  const target = Number(endValue || 0);
  if (startValue === target) {
    element.textContent = `${target}%`;
    return;
  }
  const startTime = performance.now();

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = progress * (2 - progress);
    const current = Math.round(startValue + (target - startValue) * easeProgress);
    element.textContent = `${current}%`;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

function animateReachChart(normal, risky, bot, duration = 800) {
  if (state.reachAnimationId) {
    cancelAnimationFrame(state.reachAnimationId);
  }
  const originalMax = Math.max(normal || 0, risky || 0, bot || 0, 1000);
  const startTime = performance.now();

  function frame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = progress * (2 - progress);

    const scaleNormal = normal !== null && normal !== undefined ? normal * easeProgress : null;
    const scaleRisky = risky !== null && risky !== undefined ? risky * easeProgress : null;
    const scaleBot = bot !== null && bot !== undefined ? bot * easeProgress : null;

    drawReachChart(scaleNormal, scaleRisky, scaleBot, originalMax);

    if (progress < 1) {
      state.reachAnimationId = requestAnimationFrame(frame);
    } else {
      state.reachAnimationId = null;
      drawReachChart(normal, risky, bot, originalMax);
    }
  }

  state.reachAnimationId = requestAnimationFrame(frame);
}

function drawReachChart(normal, risky, bot, originalMax) {
  const canvas = output.reachCanvas;
  const { width, height } = setupCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
  ctx.fillRect(0, 0, width, height);

  if (normal === null || normal === undefined) {
    ctx.fillStyle = "#94A3B8";
    ctx.font = "500 12px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for post intake...", width / 2, height / 2);
    ctx.textAlign = "left";
    return;
  }

  const padding = { top: 32, right: 24, bottom: 44, left: 52 };
  const max = originalMax || Math.max(normal, risky || 0, bot || 0, 1000);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + ((height - padding.top - padding.bottom) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  const drawLine = (values, strokeColor, fillColor) => {
    const grad = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    grad.addColorStop(0, fillColor + "26");
    grad.addColorStop(1, fillColor + "00");

    const points = values.map((value, index) => {
      const x = padding.left + ((width - padding.left - padding.right) * index) / (values.length - 1);
      const y = height - padding.bottom - (value / max) * (height - padding.top - padding.bottom);
      return { x, y };
    });

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(points[0].x, height - padding.bottom);
    for (let i = 0; i < points.length; i++) {
      if (i === 0) {
        ctx.lineTo(points[i].x, points[i].y);
      } else {
        const cpX1 = points[i - 1].x + (points[i].x - points[i - 1].x) / 2;
        const cpY1 = points[i - 1].y;
        const cpX2 = points[i - 1].x + (points[i].x - points[i - 1].x) / 2;
        const cpY2 = points[i].y;
        ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, points[i].x, points[i].y);
      }
    }
    ctx.lineTo(points[points.length - 1].x, height - padding.bottom);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3.5;
    ctx.shadowBlur = 10;
    ctx.shadowColor = strokeColor;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) {
        ctx.moveTo(points[i].x, points[i].y);
      } else {
        const cpX1 = points[i - 1].x + (points[i].x - points[i - 1].x) / 2;
        const cpY1 = points[i - 1].y;
        const cpX2 = points[i - 1].x + (points[i].x - points[i - 1].x) / 2;
        const cpY2 = points[i].y;
        ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, points[i].x, points[i].y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  drawLine([normal * 0.1, normal * 0.32, normal * 0.61, normal], "#3DD598", "#3DD598");
  if (risky !== null && risky !== undefined) {
    drawLine([risky * 0.12, risky * 0.46, risky * 0.78, risky], "#FFB648", "#FFB648");
  }
  if (bot !== null && bot !== undefined) {
    drawLine([bot * 0.2, bot * 0.6, bot * 0.9, bot], "#FF5C7A", "#FF5C7A");
  }

  ctx.fillStyle = "#94A3B8";
  ctx.font = "bold 11px 'Plus Jakarta Sans', sans-serif";

  ctx.fillStyle = "#3DD598";
  ctx.fillText("• NORMAL", padding.left, 20);
  if (risky !== null && risky !== undefined) {
    ctx.fillStyle = "#FFB648";
    ctx.fillText("• RISK ADJUSTED", padding.left + 78, 20);
  }
  if (bot !== null && bot !== undefined) {
    ctx.fillStyle = "#FF5C7A";
    ctx.fillText("• COORDINATED", padding.left + 192, 20);
  }

  ctx.fillStyle = "#94A3B8";
  ctx.font = "500 11px 'Inter', sans-serif";
  ctx.fillText("Time (2h)", width / 2 - 20, height - 12);

  ctx.save();
  ctx.translate(16, height / 2 + 54);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Projected Impressions", 0, 0);
  ctx.restore();
}

const agentNames = [
  "Priya Nair", "Amit Sharma", "Siddharth Roy", "Ananya Iyer", "Rajesh Patel",
  "Sneha Gupta", "Vikram Malhotra", "Kavita Rao", "Arjun Verma", "Divya Deshmukh",
  "Sarah Jenkins", "David Miller", "Elena Rostova", "Yuki Tanaka", "Michael Chang",
  "Carlos Garcia", "Fatima Al-Sayed", "Liam O'Connor", "Chloe Laurent", "Hans Mueller",
  "Aisha Bello", "Kofi Mensah", "Ji-Yeon Kim", "Ravi Shankar", "Deepa Kumari",
  "Zoe Wang", "Omar Farooq", "Emily Watson", "Alex Carter", "Sofia Rossi"
];

const segments = [
  { name: "Local News Reader", color: "#4F8CFF" },
  { name: "Tech Professional", color: "#7C5CFF" },
  { name: "Public Health Voice", color: "#3DD598" },
  { name: "Student Activist", color: "#FFB648" },
  { name: "General Audience", color: "#94A3B8" }
];

function generateSimulationPopulation(analysis, width, height) {
  const risk = analysis?.botSimulation?.riskScore ?? 0;
  const numNodes = Math.round(95 + risk * 0.45);
  const nodes = [];
  const edges = [];
  const center = { x: width / 2, y: height / 2 };

  // Calculate dynamic scaling factor to utilize space on larger displays
  const baseScale = Math.min(width / 420, height / 240) * 0.92;

  nodes.push({
    id: 0,
    name: "Original Post Content",
    segment: "Root propagation node",
    action: "posted",
    reason: "Initial trigger point of social network spread.",
    x: center.x,
    y: center.y,
    status: "active",
    radius: 16,
    color: risk >= 60 ? "#FF5C7A" : "#4F8CFF",
    activationTick: 0,
    cluster: -1
  });

  const numClusters = 5;
  const clusterAngles = [];
  for (let c = 0; c < numClusters; c++) {
    // Distribute angles evenly with a small organic random jitter
    clusterAngles.push((Math.PI * 2 * c) / numClusters + (Math.random() - 0.5) * 0.4);
  }

  for (let c = 0; c < numClusters; c++) {
    const clusterAngle = clusterAngles[c];
    // Push clusters further from center based on scaling factor
    const clusterDistance = (66 + Math.random() * 6) * baseScale;
    const clusterCenter = {
      x: center.x + Math.cos(clusterAngle) * clusterDistance,
      y: center.y + Math.sin(clusterAngle) * clusterDistance
    };

    const nodesInCluster = Math.floor((numNodes - 1) / numClusters);
    for (let i = 0; i < nodesInCluster; i++) {
      const id = nodes.length;
      // Jitter the angle of individual nodes slightly for an organic cloud effect
      const angle = (Math.PI * 2 * i) / nodesInCluster + (Math.random() - 0.5) * 0.35;
      // Spread out nodes in each cluster based on scaling factor
      const dist = (16 + Math.random() * 26) * baseScale;

      const isBot = Math.random() < (risk / 110);
      const segmentObj = isBot
        ? { name: "Coordinated Bot Profile", color: "#FF5C7A" }
        : segments[id % segments.length];

      let action = "ignored";
      let reason = "Topic does not interest this profile.";

      if (isBot) {
        action = "shared";
        reason = "Automated bot script triggered coordinated repost.";
      } else if (risk > 45 && Math.random() < 0.6) {
        action = Math.random() < 0.45 ? "shared" : "liked";
        reason = "Post aligns with political/local interests and spreads rapidly.";
      } else if (Math.random() < 0.25) {
        action = "liked";
        reason = "Liked the text content but didn't reshare it.";
      }

      nodes.push({
        id,
        name: isBot ? `Bot-ID ${1000 + id}` : agentNames[id % agentNames.length],
        segment: segmentObj.name,
        action,
        reason,
        x: clusterCenter.x + Math.cos(angle) * dist,
        y: clusterCenter.y + Math.sin(angle) * dist,
        status: "inactive",
        radius: isBot ? 6.5 : 5.5,
        color: isBot ? "#FF5C7A" : segmentObj.color,
        activationTick: action === "shared"
          ? Math.round(5 + Math.random() * 25 + (isBot ? 0 : 10))
          : action === "liked"
            ? Math.round(10 + Math.random() * 25)
            : 999,
        cluster: c
      });

      if (Math.random() < 0.45 || isBot) {
        edges.push({ source: 0, target: id });
      }

      if (i > 0) {
        edges.push({ source: id - 1, target: id });
      }
      if (i === nodesInCluster - 1) {
        edges.push({ source: id - nodesInCluster + 1, target: id });
      }
    }
  }

  return { nodes, edges };
}

function renderNetworkCanvas() {
  const canvas = output.botCanvas;
  const ctx = canvas.getContext("2d");
  if (!state.simulation) return;

  const { nodes, edges, tick, maxTicks, analysis, hoveredNode } = state.simulation;
  const width = canvas.width / (window.devicePixelRatio || 1);
  const height = canvas.height / (window.devicePixelRatio || 1);

  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
  ctx.fillRect(0, 0, width, height);

  const risk = analysis?.botSimulation?.riskScore ?? 0;
  const isCoordinationPhase = state.simulation.currentPhase === 3;

  edges.forEach((edge) => {
    const sourceNode = nodes[edge.source];
    const targetNode = nodes[edge.target];
    const maxActivation = Math.max(sourceNode.activationTick, targetNode.activationTick);

    if (tick >= maxActivation || edge.source === 0) {
      const isActive = sourceNode.status === "active" && targetNode.status === "active";
      let strokeStyle = isActive
        ? "rgba(79, 140, 255, 0.25)"
        : "rgba(255, 255, 255, 0.03)";
      let lineWidth = isActive ? 1.8 : 1.0;

      // If we are in the coordination phase, gently pulse the bot connections red!
      if (isCoordinationPhase && (sourceNode.color === "#FF5C7A" || targetNode.color === "#FF5C7A")) {
        const alpha = 0.12 + (Math.sin(Date.now() / 450) * 0.5 + 0.5) * 0.28;
        strokeStyle = `rgba(255, 92, 122, ${alpha})`;
        lineWidth = 2.0;
      }

      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(sourceNode.x, sourceNode.y);
      ctx.lineTo(targetNode.x, targetNode.y);
      ctx.stroke();
    }
  });

  nodes.forEach((node) => {
    const isActive = node.status === "active" || node.id === 0;
    let radius = 0;
    
    if (node.id === 0) {
      radius = node.radius;
    } else if (node.status === "active") {
      const age = tick - node.activationTick;
      const growthScale = Math.min(1.0, age / 6);
      radius = node.radius * growthScale;
    }

    if (radius <= 0) return;

    let fillStyle = isActive ? node.color : "#475569";
    let shadowBlur = isActive ? (node.id === 0 ? 12 : 5) : 0;

    const isHoveredBotCluster = hoveredNode && 
                                hoveredNode.color === "#FF5C7A" && 
                                node.color === "#FF5C7A" && 
                                hoveredNode.cluster === node.cluster;
    
    if (isHoveredBotCluster) {
      shadowBlur = 18;
      radius = radius + 2.0;
      fillStyle = "#FF5C7A";
    } else if (hoveredNode && hoveredNode.id === node.id) {
      shadowBlur = 18;
      radius = radius + 2.0;
      if (node.id !== 0) fillStyle = node.color;
    } else if (isCoordinationPhase && node.color === "#FF5C7A" && node.id !== 0) {
      const scale = 1.0 + (Math.sin(Date.now() / 450) * 0.5 + 0.5) * 0.15;
      radius = radius * scale;
      shadowBlur = 6 + (Math.sin(Date.now() / 450) * 0.5 + 0.5) * 8;
      fillStyle = "#FF5C7A";
    }

    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.shadowBlur = shadowBlur;
    ctx.shadowColor = ctx.fillStyle;
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  ctx.fillStyle = "#F8FAFC";
  ctx.font = "bold 12px 'Plus Jakarta Sans', sans-serif";
  ctx.fillText(`COORDINATION RISK: ${percent(risk)}`, 16, 24);

  ctx.fillStyle = "#94A3B8";
  ctx.font = "500 11px 'Inter', sans-serif";
  ctx.fillText(`Propagation: Tick ${Math.round(tick)} / ${maxTicks}`, 16, 42);

  const engagedCount = nodes.filter(n => n.status === "active" && n.id !== 0).length;
  ctx.fillText(`Active Nodes: ${engagedCount} / ${nodes.length - 1}`, 16, 56);

  const isFullyGenerated = tick >= 60 || state.simulation.currentPhase >= 6;
  if (hoveredNode && isFullyGenerated) {
    drawHoverTooltip(ctx, hoveredNode, width, height, nodes);
  }
}

function drawHoverTooltip(ctx, node, width, height, nodes) {
  const isBot = node.color === "#FF5C7A" && node.id !== 0;
  const cardWidth = 200;
  const cardHeight = isBot ? 115 : 90;
  let x = node.x + 12;
  let y = node.y - 30;

  if (x + cardWidth > width) x = node.x - cardWidth - 12;
  if (y + cardHeight > height) y = height - cardHeight - 12;
  if (y < 12) y = 12;

  ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
  ctx.strokeStyle = isBot ? "rgba(255, 92, 122, 0.5)" : "rgba(79, 140, 255, 0.3)";
  ctx.lineWidth = 1.2;
  ctx.shadowBlur = 12;
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";

  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, cardWidth, cardHeight, 6);
  } else {
    ctx.rect(x, y, cardWidth, cardHeight);
  }
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#F8FAFC";
  ctx.font = "bold 10.5px 'Plus Jakarta Sans', sans-serif";

  if (isBot) {
    const clusterNames = ["Cluster Alpha", "Cluster Beta", "Cluster Gamma", "Cluster Delta", "Cluster Epsilon"];
    const clusterName = clusterNames[node.cluster] || "Cluster Alpha";
    
    // Calculate cluster stats
    const clusterBots = nodes.filter(n => n.cluster === node.cluster && n.color === "#FF5C7A");
    const activeClusterBots = clusterBots.filter(n => n.status === "active");

    ctx.fillText(node.name, x + 10, y + 16);
    
    ctx.fillStyle = "#FF5C7A";
    ctx.font = "bold 8.5px 'Inter', sans-serif";
    ctx.fillText(`${clusterName.toUpperCase()} • BOT CLUSTER`, x + 10, y + 28);
    
    ctx.fillStyle = "#E2E8F0";
    ctx.font = "500 9px 'Inter', sans-serif";
    ctx.fillText(`Linked: ${clusterBots.length} bots (${activeClusterBots.length} active)`, x + 10, y + 40);

    ctx.fillStyle = "#FFB648";
    ctx.font = "bold 8.5px 'Inter', sans-serif";
    ctx.fillText("COORDINATION SIGNALS:", x + 10, y + 54);
    
    ctx.fillStyle = "#94A3B8";
    ctx.font = "8.5px 'Inter', sans-serif";
    ctx.fillText("✓ Shared repost template", x + 10, y + 66);
    ctx.fillText("✓ Simultaneous activation", x + 10, y + 76);
    ctx.fillText("✓ Repeated pattern • Overlap", x + 10, y + 86);
    ctx.fillText("✓ Idempotency signature", x + 10, y + 96);
  } else {
    ctx.fillText(node.name, x + 10, y + 16);

    ctx.fillStyle = node.color || "#94A3B8";
    ctx.font = "bold 8.5px 'Inter', sans-serif";
    ctx.fillText(node.segment.toUpperCase(), x + 10, y + 28);

    ctx.fillStyle = "#E2E8F0";
    ctx.font = "500 9px 'Inter', sans-serif";
    ctx.fillText(`Status: ${node.action.toUpperCase()}`, x + 10, y + 42);

    ctx.fillStyle = "#94A3B8";
    ctx.font = "9px 'Inter', sans-serif";
    const words = node.reason.split(" ");
    let line = "";
    let lineCount = 0;
    for (let w = 0; w < words.length; w++) {
      const testLine = line + words[w] + " ";
      const metrics = ctx.measureText(testLine);
      if (metrics.width > cardWidth - 20) {
        ctx.fillText(line, x + 10, y + 56 + lineCount * 10);
        line = words[w] + " ";
        lineCount++;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x + 10, y + 56 + lineCount * 10);
  }
}

function runNetworkSimulation(analysis) {
  const canvas = output.botCanvas;
  const { width, height } = setupCanvas(canvas);

  if (state.animationFrameId) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = null;
  }
  state.renderLoopActive = false;

  const { nodes, edges } = generateSimulationPopulation(analysis, width, height);

  state.simulation = {
    nodes,
    edges,
    tick: 0,
    targetTick: 0,
    maxTicks: 60,
    analysis,
    currentPhase: 0,
    hoveredNode: null
  };

  startNetworkRenderLoop();
}

function startNetworkRenderLoop() {
  if (state.animationFrameId) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = null;
  }
  state.renderLoopActive = true;

  function loop() {
    if (!state.simulation || !state.renderLoopActive) return;

    const sim = state.simulation;
    let needsMoreFrames = false;

    if (sim.tick < sim.targetTick) {
      sim.tick += 0.45;
      if (sim.tick > sim.targetTick) sim.tick = sim.targetTick;

      sim.nodes.forEach((node) => {
        if (node.activationTick <= sim.tick) {
          if (node.segment.includes("Bot") && sim.currentPhase < 3) {
            node.status = "inactive";
          } else if (node.id !== 0 && sim.currentPhase < 2) {
            node.status = "inactive";
          } else {
            node.status = "active";
          }
        }
      });
      needsMoreFrames = true;
    }

    if (sim.currentPhase === 3 || sim.currentPhase === 5) {
      needsMoreFrames = true;
    }

    renderNetworkCanvas();

    if (needsMoreFrames) {
      state.animationFrameId = requestAnimationFrame(loop);
    } else {
      state.renderLoopActive = false;
      state.animationFrameId = null;
    }
  }

  state.animationFrameId = requestAnimationFrame(loop);
}

function drawBotCanvas(analysis) {
  if (!analysis) {
    const canvas = output.botCanvas;
    const { width, height } = setupCanvas(canvas);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#94A3B8";
    ctx.font = "500 12px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for post intake...", width / 2, height / 2);
    ctx.textAlign = "left";
    return;
  }
  runNetworkSimulation(analysis);
  if (state.simulation) {
    state.simulation.tick = 60;
    state.simulation.targetTick = 60;
    state.simulation.currentPhase = 6;
    state.simulation.nodes.forEach(node => {
      node.status = "active";
    });
  }
}

function updateBoardroomCard(agentId, cardState, data = {}) {
  const card = document.querySelector(`#card-${agentId}`);
  if (!card) return;

  card.className = `boardroom-card state-${cardState}`;

  const statusEl = card.querySelector(".card-status");
  const recEl = card.querySelector(".card-rec");
  const reasonEl = card.querySelector(".card-reason");
  const metaEl = card.querySelector(".card-meta");

  statusEl.textContent = cardState.toUpperCase();

  if (cardState === "pending") {
    recEl.textContent = "Rec: --";
    reasonEl.textContent = "Waiting...";
    metaEl.textContent = "Confidence: --";
  } else if (cardState === "analyzing") {
    recEl.textContent = "Rec: --";
    reasonEl.textContent = "Running models...";
    metaEl.textContent = "Confidence: --";
  } else {
    if (data.rec) {
      recEl.textContent = `Rec: ${data.rec}`;
      const recType = data.rec.toLowerCase();
      if (recType.includes("allow")) card.classList.add("vote-allow");
      else if (recType.includes("contain") || recType.includes("containment")) card.classList.add("vote-containment");
      else card.classList.add("vote-label") || card.classList.add("vote-source") || card.classList.add("vote-throttle") || card.classList.add("vote-review");
    }
    if (data.reason) reasonEl.textContent = data.reason;
    if (data.confidence) metaEl.textContent = `Confidence: ${data.confidence}`;
  }
}

function getGovernanceEnforcementDialogue(action) {
  const dialogMap = {
    allow: {
      govProposal: "Recommend: Allow",
      govProposalReason: "Safety risks are within acceptable limits.",
      enfRejection: null,
      govResolution: "Agreement: Proportional response supports no intervention.",
      finalRec: "ALLOW",
      finalConfidence: "96%"
    },
    context_label: {
      govProposal: "Recommend: Allow",
      govProposalReason: "Neutral distribution is preferred to maximize expression.",
      enfRejection: "Reject: Unverified claims detected. Platform safety requires context label.",
      govResolution: "Agreement: Apply Context Label as moderate friction.",
      finalRec: "CONTEXT LABEL",
      finalConfidence: "88%"
    },
    source_required_and_label: {
      govProposal: "Recommend: Context Label",
      govProposalReason: "Label provides sufficient public warning.",
      enfRejection: "Reject: POL-SOURCE-022 demands source verification for civic/election claims.",
      govResolution: "Agreement: Require Source credentials to prevent viral rumor spread.",
      finalRec: "REQUIRE SOURCE",
      finalConfidence: "90%"
    },
    throttle_and_context_label: {
      govProposal: "Recommend: Context Label",
      govProposalReason: "Adding friction without limiting reach is less restrictive.",
      enfRejection: "Reject: Reach velocity is high. Throttling is required to contain spread.",
      govResolution: "Agreement: Apply Throttle to slow propagation of unverified claims.",
      finalRec: "THROTTLE REACH",
      finalConfidence: "92%"
    },
    human_review: {
      govProposal: "Recommend: Throttle",
      govProposalReason: "Slow reach until metrics stabilize.",
      enfRejection: "Reject: Policy confidence is too low. Autonomous enforcement is unsafe.",
      govResolution: "Agreement: Escalate post to a human moderator for review.",
      finalRec: "HUMAN REVIEW",
      finalConfidence: "86%"
    },
    human_review_and_trend_pause: {
      govProposal: "Recommend: Context Label",
      govProposalReason: "Apply label while monitoring metrics.",
      enfRejection: "Reject: Coordination risks are high. Trend pause must be applied.",
      govResolution: "Agreement: Pause trend eligibility and route to human review.",
      finalRec: "TREND PAUSE + REVIEW",
      finalConfidence: "89%"
    },
    emergency_containment: {
      govProposal: "Recommend: Human Review",
      govProposalReason: "Route to review queue before taking severe action.",
      enfRejection: "Reject: Critical PII or threat detected. POL-PRIVACY-018 demands immediate containment.",
      govResolution: "Agreement: Apply Emergency Containment immediately.",
      finalRec: "CONTAINMENT",
      finalConfidence: "95%"
    }
  };

  return dialogMap[action] || dialogMap.allow;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function animateStepUI(stepInfo) {
  // Clear any existing active step styling in timeline
  document.querySelectorAll(".timeline-item").forEach((item) => {
    item.classList.remove("active-step");
  });

  const row = document.createElement("li");
  row.className = "timeline-item active-step";

  let traceHtml = "";
  if (stepInfo.trace) {
    traceHtml = `
      <div class="timeline-trace" style="margin-top: 8px; border-top: 1px dashed var(--line); padding-top: 8px; font-size: 0.85rem; color: #cbd5e1;">
        ${stepInfo.trace.finding ? `<div style="margin-bottom: 4px;"><strong>↓ Finding:</strong> ${escapeHtml(stepInfo.trace.finding)}</div>` : ""}
        ${stepInfo.trace.confidence ? `<div style="margin-bottom: 4px;"><strong>Confidence:</strong> ${escapeHtml(stepInfo.trace.confidence)}</div>` : ""}
        ${stepInfo.trace.impact ? `<div style="margin-bottom: 4px;"><strong>Impact:</strong> ${escapeHtml(stepInfo.trace.impact)}</div>` : ""}
        ${stepInfo.trace.considered ? `<div style="margin-bottom: 4px;"><strong>Considered:</strong> ${escapeHtml(stepInfo.trace.considered)}</div>` : ""}
        ${stepInfo.trace.selected ? `<div style="margin-bottom: 4px;"><strong>Selected:</strong> ${escapeHtml(stepInfo.trace.selected)}</div>` : ""}
        ${stepInfo.trace.reason ? `<div style="margin-bottom: 4px;"><strong>Reason:</strong> ${escapeHtml(stepInfo.trace.reason)}</div>` : ""}
      </div>
    `;
  }

  row.innerHTML = `
    <strong>${escapeHtml(stepInfo.step)}. ${escapeHtml(stepInfo.agent)}</strong>
    <p style="margin: 4px 0 6px;">${escapeHtml(stepInfo.explanation)}</p>
    <span>Status: ${escapeHtml(stepInfo.status)} | Score: ${percent(stepInfo.score)}</span>
    ${traceHtml}
  `;
  output.timeline.append(row);

  const timelinePanel = document.querySelector(".timeline-panel");
  if (timelinePanel) {
    timelinePanel.scrollTop = timelinePanel.scrollHeight;
  }

  // Boardroom Card and graph transitions
  if (stepInfo.step === 1) {
    updateBoardroomCard("content", "analyzing");
    if (state.simulation) {
      state.simulation.currentPhase = 1;
      state.simulation.targetTick = 10;
      if (!state.renderLoopActive) startNetworkRenderLoop();
    }
    await sleep(900);
    animateNumber(output.contentScore, stepInfo.score);
    updateScoreBandElement(output.contentBand, stepInfo.score);
    updateBoardroomCard("content", "voted", {
      rec: stepInfo.score >= 40 ? "LABEL / CONTAIN" : "ALLOW",
      reason: stepInfo.trace?.finding || stepInfo.explanation,
      confidence: percent(stepInfo.score)
    });
  } else if (stepInfo.step === 2) {
    updateBoardroomCard("amplification", "analyzing");
    if (state.simulation) {
      state.simulation.currentPhase = 2;
      state.simulation.targetTick = 25;
      if (!state.renderLoopActive) startNetworkRenderLoop();
    }
    
    // Draw reach chart with Normal and Risk-Adjusted lines
    state.tempReach = {
      normal: stepInfo.trace?.normalReach,
      risky: stepInfo.trace?.riskAdjustedReach,
      bot: null
    };
    animateReachChart(state.tempReach.normal, state.tempReach.risky, null);

    await sleep(900);
    animateNumber(output.amplificationScore, stepInfo.score);
    updateScoreBandElement(output.amplificationBand, stepInfo.score);
    updateBoardroomCard("amplification", "voted", {
      rec: stepInfo.score >= 50 ? "THROTTLE / PAUSE" : "ALLOW",
      reason: stepInfo.explanation,
      confidence: percent(stepInfo.score)
    });
  } else if (stepInfo.step === 3) {
    updateBoardroomCard("coordination", "analyzing");
    if (state.simulation) {
      state.simulation.currentPhase = 3;
      state.simulation.targetTick = 45;
      if (!state.renderLoopActive) startNetworkRenderLoop();
    }
    
    // Add the Coordinated line to the reach chart
    if (state.tempReach) {
      state.tempReach.bot = stepInfo.trace?.amplifiedReach;
      animateReachChart(state.tempReach.normal, state.tempReach.risky, state.tempReach.bot);
    }

    await sleep(900);
    animateNumber(output.coordinationScore, stepInfo.score);
    updateScoreBandElement(output.coordinationBand, stepInfo.score);
    updateBoardroomCard("coordination", "voted", {
      rec: stepInfo.score >= 55 ? "THROTTLE / CONTAIN" : "ALLOW",
      reason: stepInfo.explanation,
      confidence: percent(stepInfo.score)
    });
  } else if (stepInfo.step === 4) {
    updateBoardroomCard("policy", "analyzing");
    if (state.simulation) {
      state.simulation.currentPhase = 4;
      state.simulation.targetTick = 52;
      if (!state.renderLoopActive) startNetworkRenderLoop();
    }
    await sleep(900);
    output.retrievalMode.textContent = stepInfo.explanation.includes("fallback")
      ? "local-policy-corpus"
      : "live-foundry-iq";
    updateBoardroomCard("policy", "voted", {
      rec: stepInfo.trace?.impact || "POL-AMPLIFY-001",
      reason: stepInfo.explanation,
      confidence: percent(stepInfo.score)
    });
  } else if (stepInfo.step === 5) {
    updateBoardroomCard("governance", "analyzing");
    updateBoardroomCard("enforcement", "analyzing");
    if (state.simulation) {
      state.simulation.currentPhase = 5;
      state.simulation.targetTick = 56;
      if (!state.renderLoopActive) startNetworkRenderLoop();
    }
    await sleep(800);

    // Dynamic conflict animation
    const finalAction = state.pendingFinalResult?.enforcement?.action || "allow";
    const dialogue = getGovernanceEnforcementDialogue(finalAction);

    // Initial Proposal
    updateBoardroomCard("governance", "voted", {
      rec: dialogue.govProposal,
      reason: dialogue.govProposalReason,
      confidence: "81%"
    });

    if (dialogue.enfRejection) {
      updateBoardroomCard("enforcement", "analyzing");
      await sleep(1000);

      // Rejection / Conflict state
      updateBoardroomCard("enforcement", "conflict", {
        rec: "REJECT PROPOSAL",
        reason: dialogue.enfRejection,
        confidence: dialogue.finalConfidence
      });
      updateBoardroomCard("governance", "conflict", {
        rec: "ESCALATING RESOLUTION",
        reason: "Resolving action proportionality bounds...",
        confidence: "81%"
      });

      // Animate consensus meter scaling
      const valEl = document.querySelector("#consensusValue");
      const meterEl = document.querySelector("#consensusMeter");
      const steps = [0, 25, 50, 75, 100];
      for (const consensusVal of steps) {
        if (valEl) valEl.textContent = `${consensusVal}%`;
        if (meterEl) meterEl.style.width = `${consensusVal}%`;
        await sleep(200);
      }

      await sleep(400);
      // Settle on consensus recommendation
      updateBoardroomCard("governance", "consensus", {
        rec: dialogue.finalRec,
        reason: dialogue.govResolution,
        confidence: dialogue.finalConfidence
      });
      updateBoardroomCard("enforcement", "consensus", {
        rec: dialogue.finalRec,
        reason: "Enforcing balanced platforms safety controls.",
        confidence: dialogue.finalConfidence
      });
    } else {
      // Direct consensus case
      const valEl = document.querySelector("#consensusValue");
      const meterEl = document.querySelector("#consensusMeter");
      if (valEl) valEl.textContent = "100%";
      if (meterEl) meterEl.style.width = "100%";
      updateBoardroomCard("governance", "consensus", {
        rec: dialogue.finalRec,
        reason: dialogue.govResolution,
        confidence: dialogue.finalConfidence
      });
      updateBoardroomCard("enforcement", "consensus", {
        rec: dialogue.finalRec,
        reason: "Proportionate distribution metrics satisfied.",
        confidence: dialogue.finalConfidence
      });
    }

    animateNumber(output.governanceScore, stepInfo.score);
    updateScoreBandElement(output.governanceBand, stepInfo.score);
  } else if (stepInfo.step === 6) {
    if (state.simulation) {
      state.simulation.targetTick = 60;
      if (!state.renderLoopActive) startNetworkRenderLoop();
    }
    output.decisionPill.textContent = stepInfo.trace?.selected || stepInfo.agent;
    output.decisionPill.className = `decision-pill ${severityClass(stepInfo.score)}`;
    await sleep(400);
  }
}

async function animateFinalResultUI(finalResult) {
  renderAnalysis(finalResult);

  // Unlock verdict block
  const verdictBlock = document.querySelector("#verdictBlock");
  if (verdictBlock) {
    verdictBlock.className = "verdict-block unlocked";
  }

  // Update boardroom resolution summary
  if (output.deliberationSummary && finalResult.governanceDeliberation) {
    const summary = finalResult.governanceDeliberation.summary || "";
    const reason = finalResult.governanceDeliberation.leastRestrictiveReason || "";
    output.deliberationSummary.textContent = `${summary} ${reason}`.trim();
  }

  // Load audit trail
  await loadAudit();
}

async function playQueue() {
  if (state.isPlaying || state.uiQueue.length === 0) return;
  state.isPlaying = true;

  try {
    const item = state.uiQueue.shift();
    if (item.type === "agent-step") {
      await animateStepUI(item.data);
      state.isPlaying = false;
      playQueue();
    } else if (item.type === "final-result") {
      await animateFinalResultUI(item.data);
      state.isPlaying = false;
      const button = fields.analyzeButton;
      if (button) {
        button.disabled = false;
        button.textContent = "Analyze";
      }
    }
  } catch (err) {
    console.error("Queue execution error:", err);
    state.isPlaying = false;
    const button = fields.analyzeButton;
    if (button) {
      button.disabled = false;
      button.textContent = "Analyze";
    }
  }
}

async function runAnalysis() {
  const button = fields.analyzeButton;
  button.disabled = true;
  button.textContent = "Analyzing...";

  resetUIPriorToAnalysis();
  state.uiQueue = [];
  state.isPlaying = false;
  state.pendingFinalResult = null;

  // Initialize network canvas graph simulation early with estimated risk for visual pacing
  const estRisk = (computeCoordinationSignals().length >= 2) ? 85 : Math.min(95, numberValue(fields.reports) * 1.5 + 15);
  runNetworkSimulation({ botSimulation: { riskScore: estRisk } });

  let finalResultQueued = false;

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
      },
      body: JSON.stringify(buildPayload())
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Request failed with status ${response.status}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const chunk of parts) {
        if (!chunk.trim()) continue;

        const lines = chunk.split("\n");
        let eventType = "";
        let dataStr = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataStr = line.slice(6).trim();
          }
        }

        if (eventType === "agent-step" && dataStr) {
          const stepInfo = JSON.parse(dataStr);
          state.uiQueue.push({ type: "agent-step", data: stepInfo });
          playQueue();
        } else if (eventType === "final-result" && dataStr) {
          const finalResult = JSON.parse(dataStr);
          state.pendingFinalResult = finalResult;
          state.uiQueue.push({ type: "final-result", data: finalResult });
          finalResultQueued = true;
          playQueue();
        } else if (eventType === "error" && dataStr) {
          const errData = JSON.parse(dataStr);
          throw new Error(errData.error || "Streaming error occurred.");
        }
      }
    }
  } catch (error) {
    output.publicExplanation.textContent = error.message;
  } finally {
    if (!finalResultQueued) {
      button.disabled = false;
      button.textContent = "Analyze";
    }
  }
}

function resetUIPriorToAnalysis() {
  if (state.animationFrameId) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = null;
  }
  if (state.reachAnimationId) {
    cancelAnimationFrame(state.reachAnimationId);
    state.reachAnimationId = null;
  }
  state.renderLoopActive = false;
  state.tempReach = { normal: null, risky: null, bot: null };

  output.contentScore.textContent = "--";
  if (output.contentBand) { output.contentBand.textContent = ""; output.contentBand.className = "score-band"; }
  output.amplificationScore.textContent = "--";
  if (output.amplificationBand) { output.amplificationBand.textContent = ""; output.amplificationBand.className = "score-band"; }
  output.coordinationScore.textContent = "--";
  if (output.coordinationBand) { output.coordinationBand.textContent = ""; output.coordinationBand.className = "score-band"; }
  output.governanceScore.textContent = "--";
  if (output.governanceBand) { output.governanceBand.textContent = ""; output.governanceBand.className = "score-band"; }

  output.decisionPill.textContent = "Deliberating...";
  output.decisionPill.className = "decision-pill warning";

  output.publicExplanation.textContent = "Agents are analyzing safety signals and policies...";

  output.timeline.innerHTML = "";
  output.citations.innerHTML = "";
  output.alternatives.innerHTML = "";
  output.deliberationSummary.textContent = "Boardroom is convening...";

  // Reset Consensus Meter
  const valEl = document.querySelector("#consensusValue");
  const meterEl = document.querySelector("#consensusMeter");
  if (valEl) valEl.textContent = "0%";
  if (meterEl) meterEl.style.width = "0%";

  // Reset boardroom cards
  const cards = ["content", "amplification", "coordination", "policy", "governance", "enforcement"];
  cards.forEach(card => updateBoardroomCard(card, "pending"));

  // Lock verdict block
  const verdictBlock = document.querySelector("#verdictBlock");
  if (verdictBlock) {
    verdictBlock.className = "verdict-block locked";
  }

  // Clear charts
  const reachCtx = output.reachCanvas.getContext("2d");
  reachCtx.clearRect(0, 0, output.reachCanvas.width, output.reachCanvas.height);
  const botCtx = output.botCanvas.getContext("2d");
  botCtx.clearRect(0, 0, output.botCanvas.width, output.botCanvas.height);
}

async function rollbackAudit(id) {
  const roleSelector = document.querySelector("#roleSelector");
  const role = roleSelector ? roleSelector.value : "reviewer";

  const existingBanner = document.querySelector(".auth-error-banner");
  if (existingBanner) existingBanner.remove();

  try {
    const response = await fetch(`/api/audit/${encodeURIComponent(id)}/rollback`, {
      method: "POST",
      headers: {
        "x-role": role
      }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    await loadAudit();
  } catch (error) {
    const banner = document.createElement("div");
    banner.className = "auth-error-banner";
    banner.innerHTML = `🛡️ <strong>Access Denied:</strong> ${escapeHtml(error.message)}`;
    const auditPanel = document.querySelector(".audit-panel");
    if (auditPanel) {
      auditPanel.append(banner);
    }
    setTimeout(() => banner.remove(), 5000);
  }
}

async function loadAudit() {
  const payload = await fetchJson("/api/audit");
  output.auditList.innerHTML = "";
  if (!payload.records.length) {
    output.auditList.innerHTML = "<p>No guardrail decisions have been applied yet.</p>";
    return;
  }

  payload.records.forEach((record) => {
    const item = document.createElement("article");
    item.className = "audit-item";
    const canRollback = record.rollbackAvailable && record.status === "applied";
    item.innerHTML = `
      <div class="audit-top">
        <h3>${escapeHtml(record.action.replaceAll("_", " "))}</h3>
        <div class="audit-actions">
          <button class="export-button" type="button" data-record-id="${escapeHtml(record.id)}">Export JSON</button>
          ${canRollback
        ? `<button class="rollback-button" type="button" data-record-id="${escapeHtml(record.id)}">Rollback</button>`
        : ""
      }
        </div>
      </div>
      <p style="margin-top: 6px;">${escapeHtml(record.explanation)}</p>
      <div class="meta-line">
        <span class="status-${record.status}">${escapeHtml(record.status)}</span>
        <span class="severity-${record.severity}">${escapeHtml(record.severity)}</span>
        <span class="audit-timestamp">${escapeHtml(new Date(record.createdAt).toLocaleString())}</span>
      </div>
    `;
    output.auditList.append(item);
  });

  // Always snap to top so the newest entry (prepended server-side) is visible first
  output.auditList.scrollTop = 0;

  document.querySelectorAll(".export-button").forEach((button) => {
    button.addEventListener("click", () => {
      const recordId = button.dataset.recordId;
      const record = payload.records.find((r) => r.id === recordId);
      if (!record) return;

      const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-evidence-${recordId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  document.querySelectorAll(".rollback-button").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      await rollbackAudit(button.dataset.recordId);
    });
  });
}

async function init() {
  const payload = await fetchJson("/api/scenarios");
  state.scenarios = payload.scenarios;
  fields.scenarioSelect.innerHTML = "";
  state.scenarios.forEach((scenario) => {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = scenario.name;
    fields.scenarioSelect.append(option);
  });

  fields.scenarioSelect.addEventListener("change", () => {
    const scenario = state.scenarios.find((item) => item.id === fields.scenarioSelect.value);
    applyScenario(scenario);
  });

  fields.analyzeButton.addEventListener("click", runAnalysis);
  fields.refreshAudit.addEventListener("click", loadAudit);

  output.botCanvas.addEventListener("mousemove", (event) => {
    if (!state.simulation) return;

    const rect = output.botCanvas.getBoundingClientRect();
    const scaleX = (output.botCanvas.width / (window.devicePixelRatio || 1)) / rect.width;
    const scaleY = (output.botCanvas.height / (window.devicePixelRatio || 1)) / rect.height;

    const mouseX = (event.clientX - rect.left) * scaleX;
    const mouseY = (event.clientY - rect.top) * scaleY;

    let nearest = null;
    let minDist = 12;

    state.simulation.nodes.forEach((node) => {
      const dist = Math.hypot(node.x - mouseX, node.y - mouseY);
      if (dist < minDist) {
        minDist = dist;
        nearest = node;
      }
    });

    if (state.simulation.hoveredNode !== nearest) {
      state.simulation.hoveredNode = nearest;
      renderNetworkCanvas();
    }
  });

  // Dynamic window resize listener to ensure canvases redraw responsively
  let resizeTimeout;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (state.latestAnalysis) {
        drawReachChart(
          state.latestAnalysis.amplificationRisk.normalReachTwoHours,
          state.latestAnalysis.amplificationRisk.riskAdjustedReachTwoHours,
          state.latestAnalysis.botSimulation.amplifiedReachThirtyMinutes
        );
        renderNetworkCanvas();
      } else if (state.tempReach) {
        drawReachChart(state.tempReach.normal, state.tempReach.risky, state.tempReach.bot);
        renderNetworkCanvas();
      }
    }, 250);
  });

  // Update Mode Badge based on server health configuration
  try {
    const health = await fetchJson("/api/health");
    const modeBadge = document.querySelector("#modeBadge");
    if (health.azureOpenAIActive && health.azureSearchActive) {
      modeBadge.textContent = "LIVE AZURE ACTIVE";
      modeBadge.className = "mode-badge live-badge";
    } else {
      modeBadge.textContent = "LOCAL POLICY CORPUS";
      modeBadge.className = "mode-badge mock-badge";
    }
  } catch (err) {
    // Falls back to MOCK default defined in html
  }

  // Wire live coordination signal detection from form inputs
  [fields.shares, fields.likes, fields.replies, fields.reports,
    fields.minutesSincePosted, fields.accountAgeDays, fields.followerCount].forEach((input) => {
    if (input) input.addEventListener("input", updateCoordSignalsDisplay);
  });

  applyScenario(state.scenarios[0]);
  drawReachChart(null, null, null);
  drawBotCanvas(null);
  await loadAudit();
}

init().catch((error) => {
  output.publicExplanation.textContent = error.message;
});
