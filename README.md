# Takshashila QMD Converter

Internal microsite that converts a Google Doc to a Quarto Markdown (`.qmd`) file
and a rendered PDF — ready to upload to Google Drive for the Takshashila website pipeline.

---

## How it works

1. Researcher writes the paper in Google Docs (with normal heading styles, Google footnotes, and optionally `[aside]` / `[/aside]` tags for sidenotes).
2. Sets the share permissions to **Anyone with the link can view**.
3. Pastes the URL into the converter, fills in the metadata form, and clicks **Convert**.
4. Downloads a `.zip` containing:
   - `{filename}.qmd` — ready to upload to Google Drive
   - `assets/{filename}.pdf` — the rendered PDF
   - `images/` — all extracted images

---

## Google Docs conventions

| Feature | How to write it |
|---|---|
| Headings | Use Google Docs heading styles (Heading 1, Heading 2, Heading 3) |
| Bold / italic | Normal Google Docs bold/italic |
| Links | Normal hyperlinks |
| Footnotes | Use Insert → Footnote in Google Docs |
| **Sidenotes / asides** | Wrap text in `[aside]` and `[/aside]` on their own lines |
| Images | Insert normally; add a short caption as the paragraph immediately after |
| Quarto power users | Can write `:::{.aside}`, `[^N]`, etc. directly — these are passed through |

### Aside example (in your Google Doc body):
```
[aside]
Bond Credit Ratings such as AAA (highest), AA (second-highest)…
[/aside]
```

This becomes:
```markdown
:::{.aside}
Bond Credit Ratings such as AAA (highest), AA (second-highest)…
:::
```

---

## Run locally with Docker

```bash
git clone https://github.com/takshashila-institution/qmd-converter
cd qmd-converter
docker-compose up --build
```

Open **http://localhost:8000**.

Docker builds Quarto + TinyTeX automatically. The first build takes ~5 minutes.

---

## Deploy to Render.com

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) → New → Blueprint.
3. Connect the repo. Render reads `render.yaml` and deploys automatically.
4. The free "Starter" plan works, but PDF rendering may be slow (~30–60 s). Upgrade to "Standard" for production use.

---

## Run locally without Docker (development)

Requires Python 3.11+ and [Quarto](https://quarto.org/docs/get-started/) installed on your machine.

```bash
cd qmd-converter
pip install -r requirements.txt
cd app
uvicorn main:app --reload --port 8000
```

---

## Project structure

```
takshashila-converter/
├── Dockerfile
├── docker-compose.yml
├── render.yaml               # Render.com deployment
├── requirements.txt
├── app/
│   ├── main.py               # FastAPI app
│   ├── gdocs.py              # Fetch DOCX from Google Docs
│   ├── converter.py          # DOCX → QMD conversion
│   ├── renderer.py           # Quarto render + ZIP assembly
│   └── quarto_template/
│       ├── _metadata.yml     # Takshashila standard
│       └── _variables.yml
└── static/
    ├── index.html
    ├── style.css
    └── app.js
```
