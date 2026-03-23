import "dotenv/config";
import express from "express";

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(new URL("./public", import.meta.url).pathname));

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function extractJson(text) {
  // Prefer fenced json blocks if present.
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1];
  // Fallback: first { ... } block.
  const firstObj = text.match(/\{[\s\S]*\}/);
  if (firstObj?.[0]) return firstObj[0];
  return null;
}

app.post("/api/generate", async (req, res) => {
  try {
    const apiKey = requireEnv("OPENAI_API_KEY");
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    const {
      appName = "Buildly Site",
      prompt,
      style = "modern, clean, responsive",
      pages = "single page",
      primaryColor = "#7c3aed"
    } = req.body ?? {};

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 5) {
      return res.status(400).json({ error: "Prompt is required (min 5 chars)." });
    }

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
      `Brand/app name: ${appName}`,
      `Primary color: ${primaryColor}`,
      `Style: ${style}`,
      `Pages: ${pages}`,
      "Website request:",
      prompt.trim()
    ].join("\n");

    const r = await fetch("https://api.openai.com/v1/responses", {
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

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return res.status(502).json({ error: "Upstream AI error", details: errText.slice(0, 2000) });
    }

    const data = await r.json();
    const text =
      data?.output_text ??
      data?.output?.map((o) => o?.content?.map((c) => c?.text).filter(Boolean).join("")).filter(Boolean).join("\n") ??
      "";

    let jsonText = text;
    // If the model disobeys and wraps output, attempt extraction.
    if (typeof jsonText === "string" && !jsonText.trim().startsWith("{")) {
      const extracted = extractJson(jsonText);
      if (extracted) jsonText = extracted;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return res.status(500).json({
        error: "Failed to parse AI output as JSON.",
        raw: (typeof text === "string" ? text : "").slice(0, 4000)
      });
    }

    if (!parsed?.files || !Array.isArray(parsed.files)) {
      return res.status(500).json({ error: "AI output missing files[]", raw: parsed });
    }

    // Normalize paths + ensure index.html exists.
    const files = parsed.files
      .filter((f) => f && typeof f.path === "string" && typeof f.content === "string")
      .map((f) => ({ path: f.path.replace(/^\/+/, ""), content: f.content }));

    if (!files.some((f) => f.path.toLowerCase() === "index.html")) {
      return res.status(500).json({ error: "AI output did not include index.html", raw: parsed });
    }

    return res.json({
      title: parsed.title || appName,
      run: parsed.run || "Open index.html in a browser.",
      files
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

const port = Number(process.env.PORT || 5173);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Buildly running on http://localhost:${port}`);
});

