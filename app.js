const el = (id) => document.getElementById(id);

const form = el("form");
const statusEl = el("status");
const generateBtn = el("generateBtn");
const downloadBtn = el("downloadBtn");
const resetBtn = el("resetBtn");
const tabsEl = el("tabs");
const codeEl = el("code");
const previewEl = el("preview");
const copyBtn = el("copyBtn");

const apiKeyEl = el("apiKey");
const appNameEl = el("appName");
const promptEl = el("prompt");
const styleEl = el("style");
const pagesEl = el("pages");
const primaryColorEl = el("primaryColor");

el("year").textContent = new Date().getFullYear();

let lastResult = null;
let activePath = null;

function setStatus(msg, kind = "info") {
  statusEl.textContent = msg || "";
  statusEl.classList.toggle("error", kind === "error");
}

function setLoading(on) {
  generateBtn.classList.toggle("loading", on);
  generateBtn.disabled = on;
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getFile(path) {
  return lastResult?.files?.find((f) => f.path === path);
}

function renderTabs() {
  tabsEl.innerHTML = "";
  const files = lastResult?.files || [];
  for (const f of files) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", f.path === activePath ? "true" : "false");
    btn.textContent = f.path;
    btn.addEventListener("click", () => setActiveFile(f.path));
    tabsEl.appendChild(btn);
  }
}

function setActiveFile(path) {
  activePath = path;
  renderTabs();
  const f = getFile(path);
  codeEl.innerHTML = f ? escapeHtml(f.content) : "File not found.";
  copyBtn.disabled = !f;
}

function renderPreview() {
  const index = lastResult?.files?.find((f) => f.path.toLowerCase() === "index.html");
  if (!index) {
    previewEl.srcdoc = "<h2 style='font-family: system-ui; padding: 16px'>No index.html generated.</h2>";
    return;
  }

  // Basic srcdoc preview of index.html.
  // Note: relative assets load only if inlined; we keep it simple and still show the HTML.
  previewEl.srcdoc = index.content;
}

async function generate() {
  setStatus("");
  downloadBtn.disabled = true;
  copyBtn.disabled = true;

  const body = {
    appName: appNameEl.value?.trim() || "Buildly Site",
    primaryColor: primaryColorEl.value || "#7c3aed",
    prompt: promptEl.value || "",
    style: styleEl.value || "modern, clean, responsive",
    pages: pagesEl.value || "single page"
  };

  setLoading(true);
  try {
    let data = null;

    // Try local server first (recommended).
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      data = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(data?.error ? `${data.error}${data.details ? ` — ${data.details}` : ""}` : "Request failed");
      }
    } catch (serverErr) {
      // Fallback: static mode (direct call to OpenAI from browser).
      const apiKey = apiKeyEl?.value?.trim();
      if (!apiKey) {
        throw new Error(
          "Buildly server is not running, and no API key was provided. Paste your OpenAI API key (static mode) or run the server."
        );
      }

      const model = "gpt-4.1-mini";
      const system = [
        "You generate small, production-quality static websites.",
        "Return ONLY valid JSON (no markdown) matching the schema:",
        "{",
        '  "title": string,',
        '  "files": [{"path": string, "content": string}],',
        '  "run": string',
        "}",
        "Constraints:",
        "- Always include an index.html file.",
        "- Use relative links between files.",
        "- Keep it lightweight: no build tools, no React, no external APIs.",
        "- Use accessible HTML (labels, aria where needed), responsive layout, and nice spacing.",
        "- Prefer 3 files: index.html, styles.css, app.js. Inline minimal critical CSS allowed but prefer styles.css.",
        "- In index.html, reference styles.css and app.js.",
        "- Use the provided brand name and primary color.",
        "- If multi-page is requested, still provide an index.html and add additional .html files."
      ].join("\n");

      const user = [
        `Brand/app name: ${body.appName}`,
        `Primary color: ${body.primaryColor}`,
        `Style: ${body.style}`,
        `Pages: ${body.pages}`,
        "Website request:",
        (body.prompt || "").trim()
      ].join("\n");

      const rr = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: [
            { role: "system", content: system },
            { role: "user", content: user }
          ],
          temperature: 0.4
        })
      });

      if (!rr.ok) {
        const t = await rr.text().catch(() => "");
        throw new Error(`OpenAI error: ${t.slice(0, 500)}`);
      }

      const raw = await rr.json();
      const text = raw?.output_text || "";
      data = JSON.parse(text);
    }

    lastResult = data;
    const firstPath = data.files?.[0]?.path || "index.html";
    activePath = data.files.some((f) => f.path === "index.html") ? "index.html" : firstPath;

    renderTabs();
    setActiveFile(activePath);
    renderPreview();

    downloadBtn.disabled = false;
    setStatus(`Generated ${data.files.length} file(s). ${data.run ? `Run: ${data.run}` : ""}`.trim());
  } catch (e) {
    lastResult = null;
    activePath = null;
    tabsEl.innerHTML = "";
    codeEl.textContent = "Generate something to see code here.";
    previewEl.srcdoc = "";
    downloadBtn.disabled = true;
    setStatus(e?.message || "Generation failed.", "error");
  } finally {
    setLoading(false);
  }
}

async function downloadZip() {
  if (!lastResult?.files?.length) return;
  const zip = new JSZip();
  for (const f of lastResult.files) {
    zip.file(f.path, f.content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  const name = (lastResult.title || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  a.href = URL.createObjectURL(blob);
  a.download = `${name || "buildly-site"}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  generate();
});

downloadBtn.addEventListener("click", downloadZip);

copyBtn.addEventListener("click", async () => {
  const f = activePath ? getFile(activePath) : null;
  if (!f) return;
  await navigator.clipboard.writeText(f.content);
  setStatus(`Copied ${f.path} to clipboard.`);
  setTimeout(() => setStatus(""), 1400);
});

resetBtn.addEventListener("click", () => {
  if (apiKeyEl) apiKeyEl.value = "";
  appNameEl.value = "Buildly Site";
  primaryColorEl.value = "#7c3aed";
  styleEl.value = "modern, clean, responsive";
  pagesEl.value = "single page";
  promptEl.value = "";
  setStatus("");
});

