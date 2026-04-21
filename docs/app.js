/* Takshashila QMD Converter — frontend logic */

(function () {
  "use strict";

  // ── Config ──────────────────────────────────────────────────────────────────
  // After deploying the Cloudflare Worker, paste its URL here.
  // Format: https://tsh-converter-proxy.YOUR-SUBDOMAIN.workers.dev
  const WORKER_URL = "https://tsh-converter-proxy.ashwintakshashila.workers.dev";

  const POLL_INTERVAL    = 8_000;     // ms between ZIP-ready checks
  const POLL_TIMEOUT     = 1_200_000; // 20 min hard limit
  const FIND_RUN_TIMEOUT = 180_000;   // 3 min to find the Actions run ID
  const FIND_RUN_INTERVAL= 5_000;

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const form       = document.getElementById("convertForm");
  const convertBtn = document.getElementById("convertBtn");
  const btnLabel   = convertBtn.querySelector(".btn-label");
  const btnArrow   = convertBtn.querySelector("#btnArrow");
  const spinnerEl  = convertBtn.querySelector(".spinner");

  const progressArea = document.getElementById("progressArea");
  const progressMsg  = document.getElementById("progressMsg");
  const actionsLink  = document.getElementById("actionsLink");

  const resultArea       = document.getElementById("resultArea");
  const successCard      = document.getElementById("successCard");
  const errorCard        = document.getElementById("errorCard");
  const resultMsg        = document.getElementById("resultMsg");
  const errorMsg         = document.getElementById("errorMsg");
  const dlZip            = document.getElementById("dlZip");
  const errorActionsLink = document.getElementById("errorActionsLink");

  // Prefill today's date
  const dateInput = document.getElementById("date");
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  // ── Form submit ─────────────────────────────────────────────────────────────
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const runToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setLoading(true);
    hideResults();
    showProgress("Queuing job on GitHub Actions…");

    // ── Dispatch via Worker ─────────────────────────────────────────────────
    const fd = new FormData(form);
    const inputs = {
      google_doc_url: fd.get("google_doc_url"),
      title:          fd.get("title"),
      subtitle:       fd.get("subtitle")   || "",
      authors:        fd.get("authors")    || "",
      date:           fd.get("date")       || "",
      tldr:           fd.get("tldr")       || "",
      categories:     fd.get("categories") || "",
      doctype:        fd.get("doctype")    || "",
      docversion:     fd.get("docversion") || "",
      pdf_filename:   fd.get("pdf_filename"),
      render_pdf:     document.getElementById("render_pdf").checked ? "true" : "false",
      run_token:      runToken,
    };

    const dispatchedAt = Date.now();

    try {
      const resp = await fetch(`${WORKER_URL}/dispatch`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ref: "main", inputs }),
      });
      if (resp.status === 404) throw new Error("Workflow file not found on main branch.");
      if (!resp.ok) throw new Error(`Dispatch failed (${resp.status}). Check the Worker is deployed.`);
    } catch (err) {
      showError(err.message, null);
      setLoading(false);
      hideProgress();
      return;
    }

    // ── Find run ID ─────────────────────────────────────────────────────────
    let runId = null;
    try {
      runId = await findRunId(dispatchedAt);
    } catch (err) {
      showError(err.message, null);
      setLoading(false);
      return;
    }

    const REPO = "AshwinPrasadRao/docs-to-qmd";
    if (actionsLink) {
      actionsLink.href = `https://github.com/${REPO}/actions/runs/${runId}`;
      actionsLink.hidden = false;
    }

    // ── Poll for output ZIP ─────────────────────────────────────────────────
    showProgress("Converting document (~2–4 min)…");
    let success  = false;
    const deadline = Date.now() + POLL_TIMEOUT;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL);

      const status = await checkRunStatus(runId).catch(() => null);
      if (status === "failure" || status === "cancelled") {
        showError(
          `GitHub Actions job ${status}. Check the log for details.`,
          `https://github.com/${REPO}/actions/runs/${runId}`
        );
        setLoading(false);
        return;
      }
      if (status === "success") {
        showProgress("Job done — waiting for output to be published…");
      }

      const zipResp = await fetch(
        `${WORKER_URL}/output-ready?token=${runToken}`,
        { method: "HEAD", cache: "no-store" }
      ).catch(() => null);

      if (zipResp && zipResp.ok) { success = true; break; }
    }

    setLoading(false);
    hideProgress();

    if (!success) {
      showError(
        "Timed out waiting for output. The job may still be running — check GitHub Actions.",
        `https://github.com/${REPO}/actions/runs/${runId || ""}`
      );
      return;
    }

    showSuccess(`${WORKER_URL}/download?token=${runToken}`, inputs.pdf_filename);
  });

  // ── Worker helpers ───────────────────────────────────────────────────────────
  async function findRunId(dispatchedAt) {
    const deadline = Date.now() + FIND_RUN_TIMEOUT;
    while (Date.now() < deadline) {
      await sleep(FIND_RUN_INTERVAL);
      const resp = await fetch(`${WORKER_URL}/find-run?after=${dispatchedAt}`).catch(() => null);
      if (!resp || !resp.ok) continue;
      const data = await resp.json();
      if (data.id) return data.id;
    }
    throw new Error("Could not find the GitHub Actions run after 3 minutes. Check Actions manually.");
  }

  async function checkRunStatus(runId) {
    const resp = await fetch(`${WORKER_URL}/run-status?run_id=${runId}`);
    if (!resp.ok) return null;
    const { status, conclusion } = await resp.json();
    return status === "completed" ? conclusion : status;
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function validateForm() {
    let ok = true;
    ["google_doc_url", "title", "authors", "date", "pdf_filename"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el.value.trim()) { el.classList.add("error"); ok = false; }
      else el.classList.remove("error");
    });

    const urlEl = document.getElementById("google_doc_url");
    if (
      urlEl.value.trim() &&
      !urlEl.value.includes("docs.google.com") &&
      !urlEl.value.includes("drive.google.com")
    ) {
      urlEl.classList.add("error");
      ok = false;
      alert("Please paste a Google Docs URL (docs.google.com or drive.google.com).");
    }

    const fnEl = document.getElementById("pdf_filename");
    if (fnEl.value.trim() && !/^[A-Za-z0-9_\-]+$/.test(fnEl.value.trim())) {
      fnEl.classList.add("error");
      ok = false;
      alert("Filename may only contain letters, numbers, hyphens and underscores.");
    }
    return ok;
  }

  document.querySelectorAll("input, textarea").forEach((el) => {
    el.addEventListener("input", () => el.classList.remove("error"));
  });

  // ── UI helpers ───────────────────────────────────────────────────────────────
  function setLoading(on) {
    convertBtn.disabled = on;
    btnLabel.textContent = on ? "Converting…" : "Convert";
    if (btnArrow) btnArrow.hidden = on;
    spinnerEl.hidden = !on;
  }

  function showProgress(msg) {
    progressMsg.textContent = msg;
    progressArea.hidden = false;
    progressArea.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function hideProgress() { progressArea.hidden = true; }
  function hideResults() {
    resultArea.hidden = true;
    successCard.hidden = true;
    errorCard.hidden = true;
  }

  function showSuccess(zipUrl, stem) {
    dlZip.href = zipUrl;
    dlZip.download = `${stem}.zip`;
    resultMsg.innerHTML = `Your <strong>${stem}.zip</strong> is ready — click to download. Unzip and upload the folder to your publications repo.`;
    resultArea.hidden = false;
    successCard.hidden = false;
    resultArea.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showError(msg, logsUrl) {
    errorMsg.textContent = msg;
    if (logsUrl) { errorActionsLink.href = logsUrl; errorActionsLink.hidden = false; }
    else errorActionsLink.hidden = true;
    resultArea.hidden = false;
    errorCard.hidden = false;
    resultArea.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.getElementById("tryAgainBtn").addEventListener("click", () => { hideResults(); hideProgress(); });
  document.getElementById("convertAnother").addEventListener("click", () => {
    hideResults(); hideProgress();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
})();
