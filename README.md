# Claude Code 2.1.88 — Custom Build

![](<img/2026-03-31 14-58-01-combined.gif>)

Rebuilt from source maps with real source preservation for `@ant/*` packages.

## Quick Start

Get from zero to running the `clause` command in 4 steps.

### 1. Install prerequisites

```bash
# Node.js >= 20 (via nvm or your preferred method)
nvm install 20

# Bun >= 1.1 (required for bundling)
curl -fsSL https://bun.sh/install | bash

# npm comes with Node.js — no separate install needed
```

### 2. Clone and build

```bash
git clone <repo-url> claude-code-source-build
cd claude-code-source-build

# Production build (minified, recommended — uses less memory at runtime)
node scripts/build-cli.mjs

# Or development build (unminified, faster builds, but uses more memory)
node scripts/build-cli.mjs --no-minify
```

The first build runs `npm install` for ~80 overlay packages. This takes a few minutes. Subsequent builds skip this step.

Output goes to `dist/cli.js` (wrapper) + `dist/cli.bundle/` (bundle).

### 3. Create the `clause` command

Pick one of these options:

**Option A: Shell alias (easiest, per-user)**

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
alias clause="node /absolute/path/to/claude-code-source-build/dist/cli.js"
```

Then reload:

```bash
source ~/.zshrc  # or source ~/.bashrc
```

**Option B: Symlink into PATH (system-wide)**

```bash
# Create a wrapper script
cat > /usr/local/bin/clause << 'EOF'
#!/bin/bash
exec node /absolute/path/to/claude-code-source-build/dist/cli.js "$@"
EOF
chmod +x /usr/local/bin/clause
```

**Option C: npm link (if you prefer npm-style globals)**

```bash
# From the repo root
npm link
# Then create the alias in your shell config
alias clause="claude-code-source-build"
```

Replace `/absolute/path/to/claude-code-source-build` with the actual path where you cloned the repo.

### 4. Run it

```bash
clause
```

That's it. You now have a custom Claude Code build running as `clause`.

If you get an out-of-memory error, increase the heap size:

```bash
# Add --max-old-space-size to your alias instead:
alias clause="node --max-old-space-size=8192 /absolute/path/to/claude-code-source-build/dist/cli.js"
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `bun: command not found` during build | Install bun: `curl -fsSL https://bun.sh/install \| bash`, then restart your terminal |
| `FATAL ERROR: ... heap out of memory` at runtime | Use the minified build (`node scripts/build-cli.mjs` without `--no-minify`) or add `--max-old-space-size=8192` to the node command |
| `clause: command not found` after setup | Run `source ~/.zshrc` to reload, or open a new terminal |
| First build takes a long time | Normal — it's installing ~80 npm packages. Subsequent builds are fast |
| `Cannot read properties of undefined` errors | Clean rebuild: `rm -f .cache/workspace/.prepared.json && node scripts/build-cli.mjs` |

## Feature Flags

| Flag | What it does |
|------|-------------|
| `BUILDING_CLAUDE_APPS` | Skill content for building Claude apps |
| `BASH_CLASSIFIER` | Bash command safety classifier |
| `TRANSCRIPT_CLASSIFIER` | Transcript-level auto-mode classifier |
| `CHICAGO_MCP` | Computer use via MCP (screenshot, click, type, etc.) |

Toggle in `enabledBundleFeatures` inside `scripts/build-cli.mjs`. ~90 flags available — search `feature('` in source.

## Computer Use (macOS)

Computer use runs in-process automatically when the `CHICAGO_MCP` flag is enabled. The native addons are resolved from `prebuilds/` relative to the bundled package, or via env var overrides:

```bash
COMPUTER_USE_SWIFT_NODE_PATH="/path/to/computer-use-swift.node" \
COMPUTER_USE_INPUT_NODE_PATH="/path/to/computer-use-input.node" \
clause
```

## Native Addons

In `source/native-addons/`:

| File | Purpose |
|------|---------|
| `computer-use-swift.node` | Screen capture, app management (macOS) |
| `computer-use-input.node` | Mouse/keyboard input (macOS) |
| `image-processor.node` | Sharp image processing |
| `audio-capture.node` | Audio capture |

## Clean Rebuild

```bash
rm -f .cache/workspace/.prepared.json
node scripts/build-cli.mjs
```

## Structure

```
scripts/build-cli.mjs    — Build script (source map extraction + bun bundling)
source/cli.js.map         — Original source map (4756 modules)
source/native-addons/     — Pre-built .node binaries
source/src/               — Overlay assets (.md skill files, .ts source overrides)
.cache/workspace/         — Extracted workspace (generated, gitignored)
dist/                     — Build output (generated)
```
