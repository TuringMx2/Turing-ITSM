# Turing ITSM Proposal Summary

Source: `C:\Users\luis_\Downloads\Turing_ITSM_Propuesta.pptx`.

## Goal

Build an ITSM platform that centralizes customer support, improvements, and suggestions while giving the internal team a single operational console for triage, assignments, SLA control, assets, and metrics.

## MVP scope

- Role-aware login and routing.
- Customer portal for creating tickets, viewing requests, commenting, and attaching evidence.
- Admin console with dashboard KPIs, ticket queues, filters, assignment, and customer breakdowns.
- Lightweight assets/CMDB connected to tickets.
- SLA management with policy matrix, timers, calendars, pause/stop conditions, alerts, and breach risk.
- Audit/event trail for important ticket and configuration changes.

Out of scope for the first version: complex external integrations, advanced automation, chatbot, mobile app, and fully independent microservices.

## Recommended architecture

Use a modular monolith for V1:

- Next.js + TypeScript for one web app with route groups for auth, customer portal, and admin console.
- FastAPI for a backend API that owns business rules and tenant/role enforcement.
- Supabase PostgreSQL/Auth/Storage for database, authentication primitives, and attachments.
- Redis and background workers later for SLA timers, notifications, and scheduled work.

## Core domains

- Identity & Access
- Tenants / Customers
- Tickets
- SLA Management
- Assets / CMDB
- Notifications
- Reports / Dashboard
- Audit Log
- Knowledge Base

## Security rules

- The frontend never decides permissions alone.
- Backend endpoints validate tenant, role, and permissions on every operation.
- Customers can only access their tenant's data.
- Internal comments must stay separate from customer-visible comments.
- Attachments need signed URLs and ticket-level authorization.
