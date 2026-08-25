# Turing ITSM — Database design (V1-core)

Referencia de cómo está compuesto el esquema inicial de Supabase/Postgres.
Fuente de verdad: [`supabase/migrations/20260806_initial_itsm_schema.sql`](../supabase/migrations/20260806_initial_itsm_schema.sql)
(reemplaza al antiguo `docs/database.md`, que apuntaba a una migración superada).

## Alcance

Esta V1 cubre **solo núcleo + reporter**: multi-tenant, tickets con reporters/canales,
acceso anónimo por token y RBAC interno (`support_agent`/`admin`). Assets/CMDB, SLA,
categorías y la subida de adjuntos del reporter se difieren a V1.1/V2 (sus permisos
seed ya existen en el catálogo, pero las tablas no).

## Acceso en dos canales

| Canal | Mecanismo | RLS / autoridad |
|---|---|---|
| Roles internos (`support`/`admin`) | JWT autenticado | RLS sobre tablas |
| End-user anónimo (reporter) | Token por hash (SHA-256) vía RPC | `service_role` del backend + RPC SECURITY DEFINER |

Regla de diseño: **la creación de tickets de end-user va por el backend API** (canales),
nunca por inserción directa del cliente. `supports/comments` por token es el único
ingreso no autenticado.

---

## Enums

| Tipo | Valores |
|---|---|
| `app_role` | `support_agent`, `admin` |
| `ticket_priority` | `low`, `moderate`, `high`, `urgent` |
| `ticket_status` | `new`, `assigned`, `in_progress`, `waiting_customer`, `waiting_internal`, `escalated`, `resolved`, `closed`, `cancelled` |
| `comment_visibility` | `public`, `internal` |
| `attachment_visibility` | `public`, `internal` |

_No existen `customer_user`/`customer_manager`; los consumidores se modelan con
`reporters` + tokens de acceso._

---

## Tablas

### `tenants`
`id` PK · `name` · `slug` (unique, `^[a-z0-9]+(?:-[a-z0-9]+)*$`) · `status` (`active`/`inactive`) · timestamps.

### `profiles`
`id` PK → `auth.users(id)` (cascade) · `tenant_id` → `tenants` (restrict, **nullable**) · `role` · `full_name` · `email` (check `@`) · `department` · timestamps.

- `tenant_id NULL` = perfil **no provisionado**: RLS lo deja inerte hasta que un admin
  lo asigna vía el RPC `provision_profile`.

### `reporters`
`id` PK · `tenant_id` → `tenants` · `profile_id` → `profiles` (nullable) · `name` · `email` · `phone` · `company_name` · `department` · `preferred_contact` · timestamps.
- Check: `email` **o** `phone` obligatorio.
- Índices únicos parciales: `(tenant_id, email)` y `(tenant_id, phone)` cuando no son NULL
  (permite varios reporters sin email/phone por tenant).

### `channels`
`id` PK · `code` (unique) · `label` · `is_active`. Seed: `embedded_chat`, `web_form`, `whatsapp`, `api`.

### `tickets` (central)
`id` PK · `ticket_number` (unique, auto) · `tenant_id` → `tenants` · **creador binario**:
`created_by_user_id` → `profiles` (nullable) **o** `reporter_id` → `reporters` (nullable)
(requiere exactamente uno — check `tickets_has_creator`).
`subject` (3–180) · `priority` (required, `ticket_priority` enum) · `description` (≥10) · `status` (default `new`) ·
`assigned_agent_id` → `profiles` · `resolved_at`/`closed_at` · timestamps.
Índices: `(tenant_id, created_at desc)`, `(status, priority)`, `(assigned_agent_id, status)`,
`(created_by_user_id, created_at)`, `(reporter_id)`.

### `ticket_comments`
`id` PK · `ticket_id` → `tickets` (cascade) · `tenant_id` → `tenants` · autor binario
(`author_user_id` | `reporter_id`) · `visibility` (default `public`) · `body` (≥1) · timestamps.
Triggers: coherencia de tenant con el ticket + autoría inmutable.

### `ticket_attachments`
`id` PK · `ticket_id` → `tickets` (cascade) · `tenant_id` → `tenants` · uploader binario
(`uploaded_by_user_id` | `reporter_id`) · `visibility` · `bucket` (**fijo** = `ticket-attachments`)
· `storage_path` (unique, key del storage) · `file_name` · `mime_type` · `size_bytes` (≥0).
Trigger: coherencia de tenant.

### `ticket_sources`
`id` PK · `ticket_id` → `tickets` (cascade) · `channel_id` → `channels` · `external_thread_id` ·
`payload` jsonb · `created_at`. **`unique (ticket_id)`**, sin RLS.

### `ticket_access_tokens`
`id` PK · `ticket_id` → `tickets` (cascade) · `reporter_id` → `reporters` (nullable) ·
`token_hash` (unique, SHA-256) · `purpose` (`view`|`respond`) · `expires_at` · `revoked_at` · `created_at`.
- Token `respond` **requiere** `reporter_id` (para atribuir el comentario). El raw token nunca se persiste.
- **Sin RLS** — solo RPC SECURITY DEFINER / backend.

### `audit_events`
`id` PK · `tenant_id` → `tenants` (nullable) · `actor_user_id` → `profiles` · `actor_role` ·
`action` · `resource_type` · `resource_id` · `old_value`/`new_value` jsonb · `ip_address` inet ·
`user_agent` · `created_at`. Índices: `(tenant_id, created_at)`, `(resource_type, resource_id)`, `(actor_user_id)`.

---

## Relaciones

```
tenants 1─* profiles · reporters · tickets · ticket_comments · ticket_attachments · audit_events
auth.users 1─1 profiles
tickets 1─* ticket_comments · ticket_attachments · ticket_access_tokens
tickets 1─1 ticket_sources    channels 1─* ticket_sources
Creador binario (disjunto): tickets / ticket_comments / ticket_attachments ← (profile | reporter)
```

---

## Funciones y RPCs

| Función | Seguridad | Rol/Grants | Propósito |
|---|---|---|---|
| `current_role`, `current_tenant_id`, `is_internal_user`, `is_admin`, `can_read_ticket`, `can_read_ticket_id` | SECURITY DEFINER | `authenticated` (no anon) | Helpers de RLS |
| `resolve_ticket_access(text) → jsonb` | SECURITY DEFINER | `anon`, `authenticated` | Vista de 1 ticket + sus comentarios `public` por token (hash validado, no expirado/revocado) |
| `add_ticket_public_comment_by_token(text,text) → jsonb` | SECURITY DEFINER | `anon`, `authenticated` | Inserta comentario `public` atribuido al reporter de un token `respond` |
| `create_ticket_access_token(uuid,text,text,timestamptz,uuid) → uuid` | SECURITY DEFINER; guarda `is_admin()` para autenticados | `authenticated`, `service_role` (nunca `anon`) | Acuña un token (`respond` exige reporter, raw ≥16 chars) |
| `provision_profile(uuid,app_role,uuid,text,text)` | SECURITY DEFINER; exige `is_admin()` | `authenticated` (no anon, no service) | Crea/actualiza perfil |

### Triggers
- `set_*_updated_at`: mantiene `updated_at` en writes.
- `assign_ticket_number`: `ticket_number` = `upper(substr(md5(slug),1,6))-<seq de 6>`
  (colisión entre tenants eliminada).
- `assert_*_tenant` (comments/attachments): `tenant_id` coherente con el ticket.
- `prevent_ticket_comment_author_change`: autoría inmutable.

---

## RLS por tabla

| Tabla | Policies |
|---|---|
| `tenants` | select por scope (interno o propio tenant) · write admin |
| `profiles` | select por scope (propio / admin / agente c/ acceso) · update admin · insert admin |
| `permissions`, `role_permissions` | select para autenticados |
| `tickets` | select solo interno · insert solo interno (`status=new`, sin assignee, `created_by=auth.uid()`, sin reporter) · update solo interno · delete solo admin |
| `ticket_comments` | insert/select por visibilidad + acceso · update (autor o interno, inmuta autoría/tenant) · sin delete |
| `ticket_attachments` | select/insert por visibilidad + acceso · delete propio o admin |
| `audit_events` | admin global · o lectura de ticket con filtro de acciones internas |
| `ticket_sources`, `ticket_access_tokens` | **sin policies** (solo via RPC/backend) |

---

## Storage

- Bucket `ticket-attachments` **privado**, `file_size_limit` = 10 MB.
- `storage.objects` RLS: read (metadatos + `can_read_ticket_id`), upload (metadata previa con
  `uploaded_by_user_id = auth.uid()`), delete (propio/admin).
- Los blobs se sirven por **signed URLs** generadas server-side (tras validar acceso a ticket+adjunto).

---

## Diferido / pendiente (no en esta V1)

- Tablas `assets`/CMDB, `sla_policies`, `categories` — permisos seed ya registrados, tablas aún no.
- **Subida de adjuntos del reporter**: el esquema lo soporta pero el flujo no está conectado
  (la RLS exige `auth.uid()`; el reporter anónimo y el backend `/report` aún no manejan archivos).
- Drift de tipos en el front: `apps/web/lib/rbac.ts`, `apps/web/lib/mock-auth.ts`,
  `packages/types/src/index.ts` todavía exponen `customer_user`/`customer_manager` +
  `submitterName/companyName/department`, que ya no existen en este esquema.