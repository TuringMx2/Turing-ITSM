export const roles = [
	"customer_user",
	"customer_manager",
	"support_agent",
	"admin",
] as const;

export type Role = (typeof roles)[number];

export function isRole(value: unknown): value is Role {
	return typeof value === "string" && roles.includes(value as Role);
}

export type Permission =
	| "ticket:create"
	| "ticket:read:own"
	| "ticket:read:tenant"
	| "ticket:read:all"
	| "ticket:update:own"
	| "ticket:update:tenant"
	| "ticket:update:all"
	| "ticket:change_status"
	| "ticket:assign"
	| "ticket:reassign"
	| "ticket:escalate"
	| "ticket:close"
	| "ticket:reopen"
	| "ticket:delete"
	| "comment:create:public"
	| "comment:create:internal"
	| "comment:read:public"
	| "comment:read:internal"
	| "attachment:create"
	| "attachment:read"
	| "dashboard:read:customer"
	| "dashboard:read:agent"
	| "dashboard:read:admin"
	| "tenant:read"
	| "tenant:create"
	| "tenant:update"
	| "tenant:disable"
	| "user:read"
	| "user:create"
	| "user:update"
	| "user:disable"
	| "user:assign_role"
	| "category:read"
	| "category:create"
	| "category:update"
	| "category:disable"
	| "sla:read"
	| "sla:create"
	| "sla:update"
	| "sla:disable"
	| "asset:read"
	| "asset:create"
	| "asset:update"
	| "asset:disable"
	| "asset:link_ticket"
	| "audit:read:ticket"
	| "audit:read:global"
	| "audit:export";

export type AppModule = {
	label: string;
	slug: string;
	description: string;
};

export const roleLabels: Record<Role, string> = {
	customer_user: "Customer User",
	customer_manager: "Customer Manager",
	support_agent: "Support Agent",
	admin: "Admin",
};

export const roleHome: Record<Role, string> = {
	customer_user: "/workspace/mis-tickets",
	customer_manager: "/workspace/dashboard",
	support_agent: "/workspace/dashboard",
	admin: "/workspace/dashboard",
};

export const roleModules: Record<Role, AppModule[]> = {
	customer_user: [
		{
			label: "Mis Tickets",
			slug: "mis-tickets",
			description: "Listado de tickets creados por vos.",
		},
		{
			label: "Crear Ticket",
			slug: "crear-ticket",
			description:
				"Formulario inicial para reportar problemas, mejoras o sugerencias.",
		},
		{
			label: "Mi Perfil",
			slug: "mi-perfil",
			description: "Datos básicos de tu usuario y sesión.",
		},
	],
	customer_manager: [
		{
			label: "Dashboard",
			slug: "dashboard",
			description: "Resumen de tickets y métricas básicas de tu empresa.",
		},
		{
			label: "Tickets de mi Empresa",
			slug: "tickets-empresa",
			description: "Tickets visibles dentro de tu tenant.",
		},
		{
			label: "Mis Tickets",
			slug: "mis-tickets",
			description: "Tickets creados por tu usuario.",
		},
		{
			label: "Crear Ticket",
			slug: "crear-ticket",
			description: "Alta de solicitudes para tu empresa.",
		},
		{
			label: "Usuarios de mi Empresa",
			slug: "usuarios-empresa",
			description:
				"Placeholder para usuarios del tenant, sujeto a permiso configurable.",
		},
		{
			label: "Mi Perfil",
			slug: "mi-perfil",
			description: "Datos básicos de tu usuario y sesión.",
		},
	],
	support_agent: [
		{
			label: "Dashboard",
			slug: "dashboard",
			description:
				"Panel operativo para seguimiento de cola, SLA y carga de trabajo.",
		},
		{
			label: "Tickets Asignados",
			slug: "tickets-asignados",
			description: "Tickets asignados al agente autenticado.",
		},
		{
			label: "Cola de Tickets",
			slug: "cola-tickets",
			description: "Tickets sin asignar, en progreso, escalados o reabiertos.",
		},
		{
			label: "Escalaciones",
			slug: "escalaciones",
			description: "Casos escalados o en riesgo operativo.",
		},
		{
			label: "Clientes",
			slug: "clientes",
			description: "Vista operativa de clientes relacionados a tickets.",
		},
		{
			label: "Assets",
			slug: "assets",
			description: "Consulta de assets y relación con tickets.",
		},
		{
			label: "Mi Perfil",
			slug: "mi-perfil",
			description: "Datos básicos de tu usuario y sesión.",
		},
	],
	admin: [
		{
			label: "Dashboard",
			slug: "dashboard",
			description: "Dashboard administrativo global.",
		},
		{
			label: "Gestión de Tickets",
			slug: "gestion-tickets",
			description:
				"Gestión global de tickets, estados, asignaciones y escalaciones.",
		},
		{
			label: "Clientes",
			slug: "clientes",
			description: "Administración de tenants/clientes.",
		},
		{
			label: "Usuarios",
			slug: "usuarios",
			description: "Administración de usuarios internos y clientes.",
		},
		{
			label: "Roles y Permisos",
			slug: "roles-permisos",
			description: "Base visual para RBAC granular.",
		},
		{
			label: "Categorías",
			slug: "categorias",
			description: "Tipos, categorías y formularios de ticket.",
		},
		{
			label: "SLA",
			slug: "sla",
			description: "Políticas, objetivos y reglas de SLA.",
		},
		{
			label: "Assets",
			slug: "assets",
			description: "Administración del catálogo de assets.",
		},
		{
			label: "Reportes",
			slug: "reportes",
			description: "Métricas globales por cliente, SLA, agente y tipo.",
		},
		{
			label: "Configuración",
			slug: "configuracion",
			description: "Configuración administrativa general.",
		},
	],
};

export const rolePermissions: Record<Role, Permission[]> = {
	customer_user: [
		"ticket:create",
		"ticket:read:own",
		"ticket:update:own",
		"ticket:reopen",
		"comment:create:public",
		"comment:read:public",
		"attachment:create",
		"attachment:read",
		"dashboard:read:customer",
		"category:read",
		"asset:read",
		"audit:read:ticket",
	],
	customer_manager: [
		"ticket:create",
		"ticket:read:own",
		"ticket:read:tenant",
		"ticket:update:own",
		"ticket:update:tenant",
		"ticket:reopen",
		"comment:create:public",
		"comment:read:public",
		"attachment:create",
		"attachment:read",
		"dashboard:read:customer",
		"category:read",
		"user:read",
		"asset:read",
		"audit:read:ticket",
	],
	support_agent: [
		"ticket:create",
		"ticket:read:all",
		"ticket:update:all",
		"ticket:change_status",
		"ticket:assign",
		"ticket:reassign",
		"ticket:escalate",
		"ticket:close",
		"ticket:reopen",
		"comment:create:public",
		"comment:create:internal",
		"comment:read:public",
		"comment:read:internal",
		"attachment:create",
		"attachment:read",
		"dashboard:read:agent",
		"sla:read",
		"asset:read",
		"asset:link_ticket",
		"audit:read:ticket",
	],
	admin: [
		"ticket:create",
		"ticket:read:all",
		"ticket:update:all",
		"ticket:change_status",
		"ticket:assign",
		"ticket:reassign",
		"ticket:escalate",
		"ticket:close",
		"ticket:reopen",
		"ticket:delete",
		"comment:create:public",
		"comment:create:internal",
		"comment:read:public",
		"comment:read:internal",
		"attachment:create",
		"attachment:read",
		"dashboard:read:agent",
		"dashboard:read:admin",
		"tenant:read",
		"tenant:create",
		"tenant:update",
		"tenant:disable",
		"user:read",
		"user:create",
		"user:update",
		"user:disable",
		"user:assign_role",
		"category:read",
		"category:create",
		"category:update",
		"category:disable",
		"sla:read",
		"sla:create",
		"sla:update",
		"sla:disable",
		"asset:read",
		"asset:create",
		"asset:update",
		"asset:disable",
		"asset:link_ticket",
		"audit:read:ticket",
		"audit:read:global",
		"audit:export",
	],
};

export function getModuleForRole(role: Role, slug: string) {
	return roleModules[role].find((module) => module.slug === slug);
}
