# Análisis y plan de evolución para Turing ITSM

Este informe consolida el estado actual comprobado del repositorio y el plan objetivo para evolucionar Turing ITSM hacia una arquitectura simple, mantenible y centrada en **Next.js + Supabase**. La carpeta FastAPI existente se considera únicamente un scaffold histórico/no utilizado para el objetivo y queda fuera del plan técnico recomendado.

## Resumen ejecutivo

Turing ITSM se encuentra en una etapa de base inicial. El repositorio ya contiene una aplicación web Next.js, paquetes compartidos, configuración inicial de Supabase y una migración SQL local para modelar roles, tickets, comentarios, adjuntos y auditoría. La interfaz actual valida navegación por rol con usuarios mock y módulos placeholder; todavía no existe una implementación funcional completa de tickets, autenticación real, persistencia remota aplicada ni operaciones productivas.

La arquitectura objetivo recomendada es **un único producto web con Next.js + TypeScript conectado directamente a Supabase Auth, PostgreSQL, Row Level Security y Storage**. Este enfoque reduce superficie operativa, evita duplicar reglas entre servicios y se alinea con el estado real del proyecto. FastAPI aparece en el repositorio como scaffold inicial, pero no debe formar parte del plan objetivo porque el informe solicitado prioriza una arquitectura exclusivamente Next.js + Supabase.

Resultado esperado al finalizar el plan de cuatro semanas: un MVP funcional con autenticación real, separación por roles, flujo de tickets operativo, comentarios y adjuntos con visibilidad controlada, paneles básicos por rol y base de datos Supabase aplicada con políticas de seguridad revisadas.

## Estructura comprobada del repositorio

| Área | Ruta | Estado observado | Uso recomendado |
|---|---|---|---|
| Aplicación web | `apps/web` | Next.js con App Router, login mock, navegación RBAC y utilidades Supabase. | Núcleo principal del producto. |
| API FastAPI | `apps/api` | Scaffold con `/health`, `/domains` y módulos placeholder. | Mantener fuera del plan objetivo; no invertir más funcionalidad ahí. |
| Paquetes compartidos | `packages/ui`, `packages/types`, `packages/validation` | Paquetes workspace iniciales. | Usarlos gradualmente para tipos, validaciones y UI reutilizable si el crecimiento lo justifica. |
| Base de datos | `supabase/migrations/20260605_initial_itsm_schema.sql` | Migración local con enums, tablas, permisos, RLS, triggers e índices. | Revisar, aplicar a Supabase y usar como fuente del modelo inicial. |
| Documentación | `README.md`, `docs/database.md`, `docs/proposal-summary.md` | Describe scaffold, baseline de base de datos y alcance propuesto. | Mantener como referencia, actualizando para reflejar Next.js + Supabase como objetivo. |

## Stack actual comprobado y stack objetivo

### Stack actual comprobado

| Capa | Tecnología observada | Evidencia | Comentario |
|---|---|---|---|
| Frontend | Next.js, React, TypeScript | `apps/web/package.json`, `apps/web/app/*` | Base activa del producto. |
| Autenticación frontend | Mock auth en `localStorage` | `apps/web/lib/mock-auth.ts` | Solo sirve para validar flujos visuales por rol. |
| Supabase cliente/SSR | `@supabase/ssr`, `@supabase/supabase-js` | `apps/web/utils/supabase/*` | Utilidades creadas, aún no integradas al login real. |
| Base de datos | Supabase PostgreSQL/Auth/Storage como baseline | `docs/database.md`, migración SQL | Migración local; no consta aplicación remota desde la sesión del repositorio. |
| Backend Python | FastAPI | `apps/api/pyproject.toml`, `apps/api/app/main.py` | Scaffold actual, sin lógica de negocio implementada. |
| Workspaces | npm workspaces | `package.json` | Monorepo simple con apps y packages. |

### Stack objetivo recomendado

| Capa | Tecnología objetivo | Justificación |
|---|---|---|
| Aplicación | Next.js + TypeScript | Unifica portal cliente, consola operativa y administración en una sola base. |
| Backend de aplicación | Next.js Server Components, Server Actions y Route Handlers cuando sean necesarios | Evita un servicio FastAPI separado y mantiene reglas cerca de la UI y Supabase. |
| Autenticación | Supabase Auth | Reemplaza usuarios mock por sesiones reales, compatible con middleware SSR. |
| Datos | Supabase PostgreSQL + RLS | Centraliza seguridad por tenant, rol y visibilidad directamente en la base. |
| Archivos | Supabase Storage con URLs firmadas | Adjuntos privados, autorizados por ticket y visibilidad. |
| Validación | TypeScript + esquemas compartidos en `packages/validation` | Evita divergencias entre formularios, acciones del servidor y datos persistidos. |
| UI reutilizable | `packages/ui` si aparecen componentes repetidos | Mantiene consistencia sin sobrediseñar antes de necesitarlo. |

> Decisión objetivo: **FastAPI no participa en la arquitectura final propuesta**. Puede quedar como scaffold histórico hasta decidir su eliminación, pero no debe recibir nuevas funcionalidades dentro de este plan.

## Arquitectura objetivo

### Principios

- **Un solo producto web:** Next.js concentra experiencia de usuario, páginas protegidas, acciones del servidor y endpoints mínimos.
- **Supabase como capa de plataforma:** Auth, PostgreSQL, RLS y Storage resuelven identidad, datos, autorización base y archivos.
- **Seguridad por capas:** la UI oculta lo que no corresponde, las acciones del servidor validan intención y Supabase RLS impide accesos indebidos.
- **Tenant-first:** los clientes y customer managers operan dentro de su tenant; soporte y admin tienen visibilidad ampliada según rol.
- **Evolución incremental:** primero tickets y roles reales; luego SLA, assets, reportes y automatizaciones.

### Vista lógica

```text
Usuarios por rol
  ├─ Cliente
  ├─ Customer Manager
  ├─ Trabajador / Support Agent
  └─ Admin
        │
        ▼
Next.js App Router
  ├─ Login y sesión con Supabase Auth
  ├─ Portal cliente
  ├─ Workspace operativo
  ├─ Administración
  ├─ Server Actions / Route Handlers
  └─ Validaciones TypeScript
        │
        ▼
Supabase
  ├─ Auth
  ├─ PostgreSQL
  ├─ Row Level Security
  └─ Storage privado para adjuntos
```

### Responsabilidades por capa

| Capa | Responsabilidad | No debe hacer |
|---|---|---|
| UI Next.js | Presentar módulos por rol, formularios, tablas, estados y feedback. | Decidir seguridad final solo en cliente. |
| Server Actions / Route Handlers | Validar entradas, invocar Supabase, normalizar errores y centralizar operaciones sensibles. | Duplicar un backend completo innecesario. |
| Supabase Auth | Gestionar sesión e identidad. | Sustituir validaciones de negocio de la aplicación. |
| Supabase PostgreSQL + RLS | Persistir datos y aplicar barreras de lectura/escritura por rol, tenant y visibilidad. | Contener lógica visual o flujos de UI. |
| Supabase Storage | Guardar adjuntos privados y servirlos con autorización. | Exponer buckets públicos para evidencia de tickets. |

## Módulos actuales

| Módulo | Evidencia actual | Estado real |
|---|---|---|
| Identity & Access | `mock-auth.ts`, `rbac.ts`, login visual, usuarios de prueba | Implementado como simulación local; pendiente Supabase Auth real. |
| Tenants / Customers | Enum/perfiles/tenants en migración; módulo placeholder en FastAPI | Modelo inicial definido; UI y operaciones reales pendientes. |
| Tickets | Tabla `tickets`, permisos y módulos de navegación | Modelo inicial definido; flujo funcional pendiente. |
| Comentarios | Tabla `ticket_comments` con visibilidad pública/interna | Modelo inicial definido; UI y acciones pendientes. |
| Adjuntos | Tabla `ticket_attachments`, bucket recomendado `ticket-attachments` | Modelo inicial definido; integración Storage pendiente. |
| SLA Management | Permisos y placeholder | Pendiente implementación funcional. |
| Assets / CMDB | Permisos y placeholder | Pendiente implementación funcional. |
| Reports / Dashboard | Módulos de navegación y permisos | Pendiente datos reales y KPIs. |
| Audit Log | Tabla `audit_events` y políticas | Pendiente escritura sistemática de eventos desde operaciones. |
| Knowledge Base | Placeholder | Fuera del MVP funcional inmediato salvo decisión posterior. |

## Incompletos y mejoras necesarias

### Incompletos críticos

- Reemplazar login mock por Supabase Auth real.
- Aplicar y validar la migración Supabase en un proyecto real o entorno local controlado.
- Crear consultas y Server Actions para tickets, comentarios y adjuntos.
- Implementar formularios reales de creación de ticket y detalle de ticket.
- Validar que RLS cubra lectura/escritura por rol y tenant antes de exponer datos.
- Generar URLs firmadas para adjuntos; no usar buckets públicos.
- Registrar eventos de auditoría para cambios relevantes.

### Mejoras recomendadas

- Extraer tipos de dominio compartidos hacia `packages/types` solo cuando estén estabilizados.
- Usar `packages/validation` para reglas de formularios y payloads de acciones del servidor.
- Convertir placeholders por módulo en pantallas mínimas verificables.
- Agregar pruebas de permisos/RLS y pruebas de flujos críticos.
- Documentar variables de entorno requeridas y proceso de despliegue.

## Diferencias por rol: cliente, customer manager, trabajador y admin

| Rol | Alcance de datos | Capacidades esperadas para el MVP | Restricciones clave |
|---|---|---|---|
| Cliente (`customer_user`) | Sus propios tickets dentro de su tenant. | Crear tickets, ver sus tickets, comentar públicamente, adjuntar evidencia, reabrir según regla. | No ve tickets de otros usuarios ni notas internas. |
| Customer Manager (`customer_manager`) | Tickets del tenant/empresa. | Ver dashboard del cliente, revisar tickets de la empresa, crear tickets, comentar públicamente, consultar usuarios de su empresa si se habilita. | No accede a datos de otros tenants ni notas internas. |
| Trabajador / Support Agent (`support_agent`) | Tickets operativos de todos los tenants según cola/asignación. | Ver cola, tickets asignados, cambiar estado, asignar/reasignar, escalar, cerrar, agregar notas internas, consultar SLA/assets. | No administra configuración global ni roles. |
| Admin (`admin`) | Acceso global. | Gestionar tickets, clientes, usuarios, roles/permisos, categorías, SLA, assets, reportes, configuración y auditoría. | Debe usarse con controles estrictos y trazabilidad. |

## Flujo de tickets propuesto para el MVP

1. **Creación:** un cliente o customer manager completa datos básicos: solicitante, empresa, departamento, asunto, prioridad y descripción.
2. **Registro:** Next.js valida el formulario y crea el ticket en Supabase con `status = new`, `tenant_id` y `created_by_user_id` correctos.
3. **Clasificación inicial:** trabajador o admin visualiza la cola, asigna responsable y ajusta estado según avance.
4. **Atención:** el trabajador actualiza estado, agrega comentarios públicos para el cliente o notas internas para el equipo.
5. **Adjuntos:** cliente y equipo agregan evidencia; Supabase Storage guarda archivos privados y la tabla registra metadatos.
6. **Escalación:** tickets complejos o en riesgo se marcan como `escalated` cuando aplique.
7. **Resolución:** el trabajador/admin marca `resolved` y comunica el resultado mediante comentario público.
8. **Cierre o reapertura:** el ticket pasa a `closed` si se acepta la resolución; cliente/customer manager puede solicitar reapertura si el proceso lo permite.
9. **Auditoría:** operaciones relevantes generan eventos en `audit_events` para trazabilidad.

Estados ya modelados en la migración: `new`, `assigned`, `in_progress`, `waiting_customer`, `waiting_internal`, `escalated`, `resolved`, `closed`, `cancelled`.

## Evidencias versus puntos pendientes

| Tema | Evidencia comprobada | Punto pendiente |
|---|---|---|
| Next.js activo | `apps/web/package.json`, App Router y componentes de workspace. | Conectar datos reales y proteger rutas con sesión Supabase. |
| RBAC visual | `apps/web/lib/rbac.ts` define roles, módulos y permisos. | Sincronizar permisos con base y validarlos en servidor/RLS. |
| Login | `login-form.tsx` + `mock-auth.ts`. | Sustituir por Supabase Auth. |
| Supabase | Utilidades SSR/browser y migración SQL. | Aplicación real, variables de entorno, pruebas RLS y Storage. |
| Tickets | Tabla, permisos, estados e índices en SQL. | UI, acciones de creación/listado/detalle, comentarios y transiciones. |
| Adjuntos | Tabla metadata y recomendación de bucket privado. | Implementar carga, autorización y URLs firmadas. |
| FastAPI | `apps/api` con health/domains y placeholders. | Excluir del plan objetivo Next.js + Supabase; no agregar lógica nueva. |
| Documentación | `docs/database.md`, `docs/proposal-summary.md`. | Actualizar narrativa para evitar ambigüedad sobre FastAPI como objetivo. |

## Planificación de cuatro semanas

| Semana | Objetivo | Actividades | Tecnologías utilizadas | Entregables | Riesgos o dependencias |
|---|---|---|---|---|---|
| Semana 1 | Base Supabase real y autenticación | Revisar migración; crear/aplicar entorno Supabase; configurar variables; reemplazar login mock por Supabase Auth; mapear perfiles y roles; proteger workspace por sesión. | Next.js, TypeScript, Supabase Auth, Supabase PostgreSQL, RLS, `@supabase/ssr`. | Login real; sesión SSR; perfiles por rol; rutas protegidas; checklist de RLS inicial. | Disponibilidad del proyecto Supabase; definición de usuarios iniciales; validación de políticas antes de datos reales. |
| Semana 2 | Flujo mínimo de tickets para cliente y customer manager | Implementar creación de ticket; listado de tickets propios y del tenant; detalle básico; comentarios públicos; validaciones compartidas. | Next.js Server Actions, Supabase PostgreSQL, TypeScript, `packages/validation`. | Formulario de ticket; vistas “Mis Tickets” y “Tickets de mi Empresa”; detalle con comentarios públicos. | Ajustes al modelo si faltan campos; pruebas de aislamiento tenant/usuario. |
| Semana 3 | Operación interna para trabajador y admin | Implementar cola operativa; asignación; cambios de estado; notas internas; vista admin de gestión de tickets; eventos de auditoría básicos. | Next.js, Supabase RLS, PostgreSQL, Server Actions, tablas `tickets`, `ticket_comments`, `audit_events`. | Cola de tickets; tickets asignados; gestión admin; notas internas; auditoría mínima. | Definir reglas exactas de transición; asegurar que notas internas nunca sean visibles para clientes. |
| Semana 4 | Adjuntos, dashboards básicos y endurecimiento | Implementar Storage privado; metadata de adjuntos; URLs firmadas; KPIs básicos por rol; pruebas manuales y técnicas; documentación de despliegue. | Supabase Storage, signed URLs, Next.js, SQL/RLS, TypeScript. | Adjuntos funcionales; dashboard inicial; validación end-to-end por rol; documentación operativa. | Tamaño/límites de archivo; revisión de permisos Storage; disponibilidad de datos de prueba representativos. |

## Tecnologías recomendadas

| Tecnología | Uso recomendado | Motivo |
|---|---|---|
| Next.js App Router | Aplicación principal, routing por grupos y workspace por módulo. | Ya está presente y permite combinar UI, SSR y operaciones server-side. |
| TypeScript | Tipado de dominio, props, acciones y validaciones. | Reduce errores en flujos con roles y estados. |
| Supabase Auth | Autenticación real y gestión de sesión. | Sustituye el mock actual con una solución integrada a PostgreSQL/RLS. |
| Supabase PostgreSQL | Persistencia relacional de tenants, perfiles, tickets, comentarios, adjuntos y auditoría. | El modelo inicial ya está diseñado en SQL. |
| Supabase Row Level Security | Control de acceso por rol, tenant y visibilidad. | Capa crítica para evitar fugas entre clientes. |
| Supabase Storage | Evidencias y archivos adjuntos. | Permite buckets privados y URLs firmadas. |
| Server Actions / Route Handlers | Mutaciones y operaciones sensibles desde Next.js. | Mantiene el objetivo sin FastAPI y evita exponer lógica crítica al cliente. |
| Paquetes internos `types` y `validation` | Tipos y validaciones compartidas cuando los flujos se estabilicen. | Evita duplicación sin crear abstracciones prematuras. |

## Resumen final

El proyecto tiene una base razonable para evolucionar hacia un MVP ITSM, pero hoy sigue siendo principalmente un scaffold: login mock, navegación por rol, placeholders y una migración local. La decisión más importante es mantener el plan objetivo enfocado en **Next.js + Supabase**, dejando FastAPI fuera de la arquitectura futura para reducir complejidad y acelerar la entrega.

El camino recomendado es implementar primero autenticación real y seguridad por rol/tenant; después tickets end-to-end; luego operación interna, auditoría, adjuntos y dashboards básicos. Cada avance debe verificarse contra RLS y visibilidad por rol, porque en un ITSM multi-tenant la separación de datos no es un detalle: es el cimiento del producto.

## Resultado esperado

Al completar el plan, Turing ITSM debería contar con un MVP usable donde:

- Clientes crean y consultan sus propios tickets.
- Customer managers ven la actividad de su empresa.
- Trabajadores gestionan cola, asignaciones, estados, comentarios y notas internas.
- Admins administran la operación global y consultan auditoría básica.
- Supabase protege datos por tenant, rol y visibilidad.
- Los adjuntos se almacenan de forma privada con acceso autorizado.
- FastAPI queda fuera del camino crítico y no condiciona la entrega del producto.
