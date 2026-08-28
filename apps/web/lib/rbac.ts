import type {
	AppRole,
	InternalRole as SharedInternalRole,
} from "@turing-itsm/types";

export const roles = [
	"customer_user",
	"customer_manager",
	"support_agent",
	"admin",
	"superadmin",
] as const satisfies readonly AppRole[];

export type Role = AppRole;

export const internalRoles = ["support_agent", "admin", "superadmin"] as const satisfies readonly SharedInternalRole[];
export type InternalRole = SharedInternalRole;

export function isRole(value: unknown): value is Role {
	return typeof value === "string" && roles.includes(value as Role);
}

export function isInternalRole(value: unknown): value is InternalRole {
	return (
		typeof value === "string" &&
		internalRoles.includes(value as InternalRole)
	);
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
	href?: string;
};

export const roleLabels: Record<InternalRole, string> = {
	support_agent: "Support Agent",
	admin: "Admin",
	superadmin: "Superadmin",
};

export const roleHome: Record<InternalRole, string> = {
	support_agent: "/workspace/home",
	admin: "/workspace/home",
	superadmin: "/workspace/home",
};

const dashboardModule: AppModule = {
	label: "Dashboard",
	slug: "dashboard",
	description: "Panel operativo para seguimiento de cola, SLA y carga de trabajo.",
};
const assignedTicketsModule: AppModule = {
	label: "Tickets Asignados",
	slug: "tickets-asignados",
	description: "Tickets asignados al agente autenticado.",
};
const ticketQueueModule: AppModule = {
	label: "Cola de Tickets",
	slug: "cola-tickets",
	description: "Tickets sin asignar, en progreso, escalados o reabiertos.",
};
const escalationsModule: AppModule = {
	label: "Escalaciones",
	slug: "escalaciones",
	description: "Casos escalados o en riesgo operativo.",
};
const customersModule: AppModule = {
	label: "Clientes",
	slug: "clientes",
	description: "Vista operativa de clientes relacionados a tickets.",
};
const assetsModule: AppModule = {
	label: "Assets",
	slug: "assets",
	description: "Consulta y administración del catálogo de assets.",
};
const profileModule: AppModule = {
	label: "Mi Perfil",
	slug: "mi-perfil",
	description: "Datos básicos de tu usuario y sesión.",
};
const dailyModule: AppModule = {
	label: "Daily",
	slug: "daily",
	description: "Responder y configurar las actualizaciones diarias de tus equipos.",
};
const projectsModule: AppModule = {
	label: "Proyectos",
	slug: "projects",
	href: "/projects",
	description: "Tableros y operación de proyectos del tenant.",
};
const ticketManagementModule: AppModule = {
	label: "Gestión de Tickets",
	slug: "gestion-tickets",
	description: "Gestión global de tickets, estados, asignaciones y escalaciones.",
};
const usersModule: AppModule = {
	label: "Usuarios",
	slug: "usuarios",
	description: "Administración de usuarios internos y clientes.",
};
const rolesPermissionsModule: AppModule = {
	label: "Roles & Permissions",
	slug: "roles-permisos",
	description: "Teams, projects, and independent staff assignments.",
};
const categoriesModule: AppModule = {
	label: "Categorías",
	slug: "categorias",
	description: "Tipos, categorías y formularios de ticket.",
};
const slaModule: AppModule = {
	label: "SLA",
	slug: "sla",
	description: "Políticas, objetivos y reglas de SLA.",
};
const reportsModule: AppModule = {
	label: "Reportes",
	slug: "reportes",
	description: "Métricas globales por cliente, SLA, agente y tipo.",
};
const settingsModule: AppModule = {
	label: "Configuración",
	slug: "configuracion",
	description: "Configuración administrativa general.",
};

export const roleModules: Record<InternalRole, AppModule[]> = {
	support_agent: [
		dashboardModule,
		dailyModule,
	],
	admin: [
		dashboardModule,
		dailyModule,
		rolesPermissionsModule,
	],
	superadmin: [
		dashboardModule,
		assignedTicketsModule,
		ticketQueueModule,
		escalationsModule,
		customersModule,
		profileModule,
		dailyModule,
		projectsModule,
		ticketManagementModule,
		usersModule,
		rolesPermissionsModule,
		categoriesModule,
		slaModule,
		assetsModule,
		reportsModule,
		settingsModule,
	],
};

export const rolePermissions: Record<InternalRole, Permission[]> = {
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
	superadmin: [
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

export function getModuleForRole(role: InternalRole, slug: string) {
	return roleModules[role].find((module) => module.slug === slug);
}

// Internal authorization helpers --------------------------------------------
export function isAdmin(role: InternalRole): boolean {
	return role === "admin" || role === "superadmin";
}

export function isSuperAdmin(role: InternalRole): boolean {
	return role === "superadmin";
}

export function canAssignSuperadmin(actorRole: InternalRole): boolean {
	return isSuperAdmin(actorRole);
}

export function canAccessAdminRoute(role: InternalRole): boolean {
	return isAdmin(role);
}

export function canManageProjects(role: InternalRole): boolean {
	return isAdmin(role);
}

export function canManageTasks(role: InternalRole): boolean {
	// admin can manage all; support_agent managed via project membership in RLS + server actions
	void role;
	return true;
}

export function hasPermission(role: InternalRole, permission: Permission): boolean {
	return rolePermissions[role].includes(permission);
}
