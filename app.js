/* Takshashila QMD Converter — GitHub Actions frontend */

(function () {
  "use strict";

  // ── Config ─────────────────────────────────────────────────────────────────
  // Fine-grained PAT with Actions: Read & Write on this repo only.
  // Create one at https://github.com/settings/personal-access-tokens/new
  // (Repository access → This repository → Actions → Read and Write)
  // then paste it here. Everyone on the team uses this same page — no individual tokens needed.
  const SHARED_TOKEN = "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";

  // Update REPO if the repository is ever renamed.
  const REPO  = "shakunasanaxe/Takshashila-webpub-render";
  const OWNER = REPO.split("/")[0];
  const NAME  = REPO.split("/")[1];

  // gh-pages base URL for polling output ZIPs.
  // GitHub Pages URL for this repo (adjust if using a custom domain).
  const PAGES_BASE = `https://${OWNER}.github.io/${NAME}`;

  // How long to poll (ms) and how often.
  const POLL_INTERVAL = 8_000;   // 8 s between checks
  const POLL_TIMEOUT  = 600_000; // 10 min hard limit

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const form        = document.getElementById("convertForm");
  const convertBtn  = document.getElementById("convertBtn");
  const btnLabel    = convertBtn.querySelector(".btn-label");
  const btnArrow    = convertBtn.querySelector("#btnArrow");
  const spinnerEl   = convertBtn.querySelector(".spinner");

  const progressArea = document.getElementById("progressArea");
  const progressMsg  = document.getElementById("progressMsg");
  const actionsLink  = document.getElementById("actionsLink");
  const pQueued      = document.getElementById("pQueued");
  const pRunning     = document.getElementById("pRunning");
  const pPublishing  = document.getElementById("pPublishing");

  const resultArea   = document.getElementById("resultArea");
  const successCard  = document.getElementById("successCard");
  const errorCard    = document.getElementById("errorCard");
  const resultMsg    = document.getElementById("resultMsg");
  const errorMsg     = document.getElementById("errorMsg");
  const dlZip        = document.getElementById("dlZip");
  const errorActionsLink = document.getElementById("errorActionsLink");


  // ── Prefill today's date ────────────────────────────────────────────────────
  const dateInput = document.getElementById("date");
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  // ── Form submit ─────────────────────────────────────────────────────────────
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const token = SHARED_TOKEN;
    if (!token || token === "PASTE_YOUR_TOKEN_HERE") {
      alert("No GitHub token configured. Open app.js and set SHARED_TOKEN to a valid fine-grained PAT.");
      return;
    }

    // Unique token the frontend uses to find its output on gh-pages
    const runToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setLoading(true);
    hideResults();
    showProgress();

    // ── Trigger the workflow ──────────────────────────────────────────────────
    const fd = new FormData(form);
    const inputs = {
      google_doc_url: fd.get("google_doc_url"),
      title:          fd.get("title"),
      subtitle:       fd.get("subtitle") || "",
      authors:        fd.get("authors") || "",
      date:           fd.get("date") || "",
      tldr:           fd.get("tldr") || "",
      categories:     fd.get("categories") || "",
      doctype:        fd.get("doctype") || "",
      docversion:     fd.get("docversion") || "",
      pdf_filename:   fd.get("pdf_filename"),
      run_token:      runToken,
    };

    let runId = null;
    try {
      const triggerResp = await fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/convert.yml/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ref: "main", inputs }),
        }
      );

      if (triggerResp.status === 401) throw new Error("Token rejected by GitHub (401). Check it hasn't expired.");
      if (triggerResp.status === 403) throw new Error("Token doesn't have the 'workflow' scope. Re-create it with that scope.");
      if (triggerResp.status === 404) throw new Error("Workflow file not found. Make sure convert.yml is on the main branch.");
      if (!triggerResp.ok) throw new Error(`GitHub API error ${triggerResp.status}.`);
    } catch (err) {
      showError(err.message, null);
      setLoading(false);
      progressArea.hidden = true;
      return;
    }

    setStep(pQueued, "done");
    setStep(pRunning, "active");
    setProgressMsg("Waiting for GitHub Actions runner to start…");

    // ── Find the run ID (GitHub dispatches are async — poll for ~30 s) ────────
    try {
      runId = await findRunId(token, runToken);
    } catch (err) {
      showError(err.message, null);
      setLoading(false);
      return;
    }

    if (actionsLink) {
      actionsLink.href = `https://github.com/${REPO}/actions/runs/${runId}`;
      actionsLink.hidden = false;
    }

    // ── Poll for the output ZIP on gh-pages ───────────────────────────────────
    setProgressMsg("Converting document…");
    const outputUrl = `${PAGES_BASE}/outputs/${runToken}/document.zip`;
    const stem      = inputs.pdf_filename;

    let success = false;
    const deadline = Date.now() + POLL_TIMEOUT;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL);

      // Check if the Actions run has failed (saves waiting the full timeout)
      const runStatus = await checkRunStatus(token, runId).catch(() => null);
      if (runStatus === "failure" || runStatus === "cancelled") {
        showError(
          `GitHub Actions job ${runStatus}. Check the log for details.`,
          `https://github.com/${REPO}/actions/runs/${runId}`
        );
        setLoading(false);
        return;
      }
      if (runStatus === "in_progress" || runStatus === "queued") {
        setProgressMsg("Still converting…");
      }

      // Check for the ZIP on gh-pages
      const zipResp = await fetch(outputUrl, { method: "HEAD", cache: "no-store" }).catch(() => null);
      if (zipResp && zipResp.ok) {
        success = true;
        break;
      }

      // Once the run completes, switch to the "publishing" step
      if (runStatus === "success") {
        setStep(pRunning, "done");
        setStep(pPublishing, "active");
        setProgressMsg("Pushing output to GitHub Pages…");
      }
    }

    setLoading(false);

    if (!success) {
      showError("Timed out waiting for the output. The job may still be running — check GitHub Actions.", `https://github.com/${REPO}/actions/runs/${runId || ""}`);
      return;
    }

    setStep(pPublishing, "done");
    setProgressMsg("");
    showSuccess(outputUrl, stem);
  });

  // ── Find the workflow run triggered by our dispatch ──────────────────────────
  // Strategy: poll GET /repos/.../actions/runs?event=workflow_dispatch
  // and find a run created in the last ~60 s that we can assume is ours.
  // (GitHub doesn't return the run ID in the dispatch response.)
  async function findRunId(token, runToken) {
    const maxWait = 60_000;
    const interval = 4_000;
    const deadline = Date.now() + maxWait;

    while (Date.now() < deadline) {
      await sleep(interval);
      const resp = await fetch(
        `https://api.github.com/repos/${REPO}/actions/runs?event=workflow_dispatch&per_page=5`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      const runs = data.workflow_runs || [];
      // Find a run created in the last 90 s
      const cutoff = Date.now() - 90_000;
      for (const run of runs) {
        if (new Date(run.created_at).getTime() > cutoff) {
          return run.id;
        }
      }
    }
    throw new Error("Could not find the GitHub Actions run. It may have been queued but not started — check Actions manually.");
  }

  async function checkRunStatus(token, runId) {
    const resp = await fetch(
      `https://api.github.com/repos/${REPO}/actions/runs/${runId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status === "completed") return data.conclusion; // success/failure/cancelled
    return data.status; // queued/in_progress
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
    if (urlEl.value.trim() && !urlEl.value.includes("docs.google.com") && !urlEl.value.includes("drive.google.com")) {
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
    btnArrow.hidden = on;
    spinnerEl.hidden = !on;
  }

  function hideResults() {
    resultArea.hidden = true;
    successCard.hidden = true;
    errorCard.hidden = true;
  }

  function showProgress() {
    progressArea.hidden = false;
    [pQueued, pRunning, pPublishing].forEach(el => {
      el.classList.remove("done", "active");
    });
    setStep(pQueued, "active");
    if (actionsLink) actionsLink.hidden = true;
    progressArea.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setStep(el, state) {
    el.classList.remove("done", "active");
    if (state) el.classList.add(state);
  }

  function setProgressMsg(msg) {
    progressMsg.textContent = msg;
  }

  function showSuccess(zipUrl, stem) {
    progressArea.hidden = true;
    dlZip.href = zipUrl;
    dlZip.download = `${stem}.zip`;
    resultMsg.innerHTML = `Your <strong>${stem}.zip</strong> is ready — click to download. Unzip it and upload the folder to your publications repo.`;
    resultArea.hidden = false;
    successCard.hidden = false;
    resultArea.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showError(msg, logsUrl) {
    progressArea.hidden = true;
    errorMsg.textContent = msg;
    if (logsUrl) {
      errorActionsLink.href = logsUrl;
      errorActionsLink.hidden = false;
    } else {
      errorActionsLink.hidden = true;
    }
    resultArea.hidden = false;
    errorCard.hidden = false;
    resultArea.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // "Try again" / "Convert another"
  document.getElementById("tryAgainBtn").addEventListener("click", () => {
    hideResults();
    progressArea.hidden = true;
  });
  document.getElementById("convertAnother").addEventListener("click", () => {
    hideResults();
    progressArea.hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
})();
