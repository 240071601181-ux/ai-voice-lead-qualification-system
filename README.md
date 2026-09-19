# MadLead AI — Text-First Lead Qualification System

## Overview

A modular, production‑ready system for AI‑driven lead qualification tailored
for logistics & transport companies. Text conversations are the primary AI
interaction model (Phase 14: the legacy voice/Vapi system is retired):
- Capture leads and converse with them over real-time text chat (web).
- Conduct multilingual conversations (Tamil, Hindi, English) via the LLM agent.
- Qualify leads (HOT/WARM/COLD) and store all data in PostgreSQL.
- Integrate with CRM, Google Calendar/Meet, WhatsApp and n8n for automation.

## Quick Start (local development)

```bash
# Clone the repo (or copy the generated folder)
cd "C:/Users/Santhosh/OneDrive/ai project1/ai-voice-lead-qualification"

# Install dependencies
npm install

# Copy example env and fill in your credentials
cp .env.example .env
# edit .env with your keys

# Run the development server
npm run dev
```

The backend starts on `http://localhost:4000`, the frontend on
`http://localhost:3000`. From the project root, `npm run dev:all` starts
both (see `docs/local-development.md`). Health check: `GET /health`.

## Project Structure

```
ai-voice-lead-qualification/
├─ src/                # Application source code
│  ├─ config/          # Configuration loaders
│  ├─ routes/          # Express route definitions
│  ├─ controllers/     # Request handling logic
│  ├─ services/        # Business logic & integrations
│  ├─ agent/           # Text-first agent: orchestrator, RAG, LLM, tools
│  ├─ tools/           # Function‑calling utilities
│  ├─ database/        # DB models & migrations
│  ├─ middleware/      # Auth, error handling, logging
│  └─ utils/           # Helpers
├─ tests/              # Unit / integration tests
├─ docs/               # Architecture & design docs
├─ .env.example        # Environment variable template
├─ .gitignore
├─ package.json
├─ tsconfig.json
└─ README.md
```

For detailed architecture, see `docs/architecture.md`.
