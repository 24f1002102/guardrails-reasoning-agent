const fs = require("node:fs");
const path = require("node:path");

const LOG_FILE_PATH = path.join(__dirname, "..", "..", "audit-log.json");
const MAX_MEMORY_RECORDS = 500;
const MAX_DISK_RECORDS = 200;
const FLUSH_DEBOUNCE_MS = 1500; // write to disk at most once per 1.5s

// ---------------------------------------------------------------------------
// Primary store: in-memory array.
// This eliminates the synchronous I/O bottleneck and the file race condition.
// Node.js is single-threaded for JS, so the in-memory array never races.
// Disk is secondary — for persistence across restarts only.
// ---------------------------------------------------------------------------
let memoryStore = [];
let flushTimer = null;
let storeReady = false;

function loadFromDisk() {
  try {
    if (!fs.existsSync(LOG_FILE_PATH)) {
      fs.writeFileSync(LOG_FILE_PATH, "[]", "utf8");
      return [];
    }
    const content = fs.readFileSync(LOG_FILE_PATH, "utf8");
    if (!content.trim()) return [];
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("[AuditStore] Failed to load from disk — starting fresh:", error.message);
    try {
      if (fs.existsSync(LOG_FILE_PATH)) {
        fs.renameSync(LOG_FILE_PATH, `${LOG_FILE_PATH}.corrupt-${Date.now()}`);
      }
      fs.writeFileSync(LOG_FILE_PATH, "[]", "utf8");
    } catch (writeError) {
      console.error("[AuditStore] Could not recover corrupt log file:", writeError.message);
    }
    return [];
  }
}

function scheduleDiskFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const snapshot = memoryStore.slice(0, MAX_DISK_RECORDS);
    fs.writeFile(LOG_FILE_PATH, JSON.stringify(snapshot, null, 2), "utf8", (err) => {
      if (err) console.error("[AuditStore] Async disk flush failed:", err.message);
    });
    flushTimer = null;
  }, FLUSH_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Author history index — fast lookup of prior enforcement for an author handle
// ---------------------------------------------------------------------------
function buildAuthorIndex(records) {
  const index = new Map(); // handle -> { count, highRiskCount }
  for (const record of records) {
    const handle = record.authorHandle;
    if (!handle) continue;
    const existing = index.get(handle) || { count: 0, highRiskCount: 0 };
    existing.count += 1;
    if (record.severity === "critical" || record.severity === "high") {
      existing.highRiskCount += 1;
    }
    index.set(handle, existing);
  }
  return index;
}

let authorIndex = new Map();

function rebuildAuthorIndex() {
  authorIndex = buildAuthorIndex(memoryStore);
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------
function createAuditStore() {
  // Bootstrap: load persisted records into memory once at startup
  if (!storeReady) {
    memoryStore = loadFromDisk();
    rebuildAuthorIndex();
    storeReady = true;
  }

  /**
   * Record a new analysis result as a new audit entry every time.
   * If the same idempotencyKey was seen before, the new entry is marked with replayedAt.
   * This ensures every "Analyse" click produces a visible row in the audit trail.
   */
  function record(analysis) {
    const key = analysis.enforcement.idempotencyKey;
    const existingIndex = memoryStore.findIndex((item) => item.idempotencyKey === key);

    // Determine if this is a replay of a previously seen idempotency key.
    // We intentionally do NOT short-circuit here — every "Analyse" click must
    // produce a visible new entry in the audit trail so the user can see it.
    const replayedAt = existingIndex !== -1 ? new Date().toISOString() : null;

    const nowStr = new Date().toISOString();
    const authorHandle = analysis.inputSummary?.author || "@demo_author";
    const entry = {
      id: analysis.analysisId,
      idempotencyKey: key,
      postVersion: analysis.enforcement.postVersion,
      authorHandle,
      createdAt: analysis.createdAt || nowStr,
      updatedAt: nowStr,
      rolledBackAt: null,
      replayedAt,
      action: analysis.enforcement.action,
      severity: analysis.enforcement.severity,
      confidence: analysis.enforcement.confidence,
      status: "applied",
      rollbackAvailable: analysis.enforcement.rollbackAvailable,
      policyCitations: analysis.foundryIq.citations.map((citation) => citation.id),
      explanation: analysis.enforcement.publicExplanation,
      evidencePackage: {
        summary: {
          selectedAction: analysis.enforcement.actionLabel || analysis.enforcement.action,
          governanceRisk: analysis.enforcement.riskScore,
          reason: analysis.enforcement.publicExplanation
        },
        contentSignals: analysis.contentSignals,
        amplificationRisk: analysis.amplificationRisk,
        botSimulation: analysis.botSimulation,
        foundryIq: {
          retrievalMode: analysis.foundryIq.retrievalMode,
          citations: analysis.foundryIq.citations,
          warning: analysis.foundryIq.warning
        },
        deliberation: analysis.governanceDeliberation
      }
    };

    // Prepend and cap in-memory store
    memoryStore.unshift(entry);
    if (memoryStore.length > MAX_MEMORY_RECORDS) {
      memoryStore = memoryStore.slice(0, MAX_MEMORY_RECORDS);
    }

    // Update author index incrementally
    const authorEntry = authorIndex.get(authorHandle) || { count: 0, highRiskCount: 0 };
    authorEntry.count += 1;
    if (entry.severity === "critical" || entry.severity === "high") {
      authorEntry.highRiskCount += 1;
    }
    authorIndex.set(authorHandle, authorEntry);

    scheduleDiskFlush();
    return entry;
  }

  /**
   * Return the 25 most recent audit records for the dashboard.
   */
  function list() {
    return memoryStore.slice(0, 25);
  }

  /**
   * Roll back an applied decision by ID.
   */
  function rollback(id) {
    const recordToRollback = memoryStore.find((item) => item.id === id);
    if (!recordToRollback || !recordToRollback.rollbackAvailable || recordToRollback.status !== "applied") {
      return null;
    }
    const nowStr = new Date().toISOString();
    recordToRollback.status = "rolled-back";
    recordToRollback.rolledBackAt = nowStr;
    recordToRollback.updatedAt = nowStr;
    scheduleDiskFlush();
    return recordToRollback;
  }

  /**
   * Return prior enforcement history for a given author handle.
   * Used by the server to enrich the analysis request before processing.
   */
  function getAuthorHistory(handle) {
    return authorIndex.get(handle) || { count: 0, highRiskCount: 0 };
  }

  return { record, list, rollback, getAuthorHistory };
}

module.exports = { createAuditStore };
