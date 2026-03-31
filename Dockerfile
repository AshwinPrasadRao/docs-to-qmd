# ── Stage 1: Build image with Quarto + TinyTeX ────────────────────────────────
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    curl \
    gdebi-core \
    perl \
    ca-certificates \
    libglib2.0-0 \
    libfontconfig1 \
    libfreetype6 \
    libpng-dev \
    libjpeg-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Quarto CLI
ARG QUARTO_VERSION=1.5.57
RUN wget -q "https://github.com/quarto-dev/quarto-cli/releases/download/v${QUARTO_VERSION}/quarto-${QUARTO_VERSION}-linux-amd64.deb" \
    && gdebi --non-interactive "quarto-${QUARTO_VERSION}-linux-amd64.deb" \
    && rm "quarto-${QUARTO_VERSION}-linux-amd64.deb"

# Install TinyTeX (via Quarto)
RUN quarto install tinytex --no-prompt

# Add TinyTeX to PATH
ENV PATH="/root/.TinyTeX/bin/x86_64-linux:${PATH}"

# Install extra LaTeX packages needed for Quarto's default PDF template
RUN tlmgr install \
    framed \
    tcolorbox \
    environ \
    trimspaces \
    amsmath \
    etoolbox \
    pgf \
    xcolor \
    fontawesome5 \
    selnolig \
    || true

# ── Python app ─────────────────────────────────────────────────────────────────
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

WORKDIR /app/app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
