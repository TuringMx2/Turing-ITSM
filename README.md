# Turing ITSM

Initial scaffold for a modular monolith ITSM platform.

## Product scope

Turing ITSM centralizes customer service requests, internal ticket operations, assets/CMDB, SLA management, audit events, notifications, and reporting. V1 starts as one Next.js web app and one FastAPI backend over Supabase PostgreSQL/Auth/Storage.

## Architecture

```text
apps/
  web/                 Single Next.js app: auth, customer portal, admin console
  api/                 FastAPI modular monolith backend
packages/
  ui/                  Shared UI primitives
  types/               Shared TypeScript domain types
  validation/          Shared validation schemas
infra/                 Runtime infrastructure notes
```

Key domains:

- Identity & Access
- Tenants / Customers
- Tickets
- SLA Management
- Assets / CMDB
- Notifications
- Reports / Dashboard
- Audit Log
- Knowledge Base

## Getting started

```bash
npm install
npm run dev:web
```

API development:

```bash
cd apps/api
python -m venv .venv
. .venv/Scripts/activate  # Windows PowerShell: .venv\\Scripts\\Activate.ps1
pip install -e .
uvicorn app.main:app --reload
```

Copy `.env.example` values into environment-specific files as needed. The current Supabase publishable values are public browser configuration only; keep service-role keys and other secrets out of the repository.

## Current status

This is a foundation scaffold only. Business rules, database schema, Supabase RLS policies, authentication flows, and production infrastructure still need implementation.
