export type AppRole =
  | "customer_user"
  | "customer_manager"
  | "support_agent"
  | "admin"
  | "superadmin";
export type InternalRole = Extract<AppRole, "support_agent" | "admin" | "superadmin">;
export type UserRole = AppRole;

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface ProjectWorkflowColumn {
  id: string;
  projectId: string;
  name: string;
  position: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  createdBy: string;
  createdAt: string;
  archivedAt?: string | null;
}

export interface ProjectMembership {
  projectId: string;
  userId: string;
  createdAt: string;
}

export type ProjectMember = ProjectMembership;

export interface DailyCheckin {
  id: string;
  userId: string;
  date: string;
  q1Yesterday: string;
  q2Today: string;
  q3Blockers?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  columnId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string;
  position: number;
  assigneeIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailyQuestion {
  id: string;
  tenantId: string;
  questionText: string;
  isActive: boolean;
  createdAt: string;
  deactivatedAt?: string | null;
}

export interface TeamDailySchedule {
  id: string;
  teamId: string;
  timezoneName: string;
  localTime: string;
  scheduledWeekdays: number[];
  responseWindow: string;
  isActive: boolean;
}

export interface DailyRun {
  id: string;
  teamId: string;
  scheduleId: string;
  scheduledFor: string;
  dueAt: string;
  localDate: string;
  timezoneSnapshot: string;
}

export interface DailyRunQuestion {
  runId: string;
  questionId: string;
  questionText: string;
  position: number;
}

export interface DailySubmission {
  id: string;
  userId: string;
  submittedAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  uploadedBy: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes: number;
  createdAt: string;
}

export interface TaskActivity {
  id: string;
  taskId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  occurredAt: string;
}

export type TicketPriority = "low" | "moderate" | "high" | "urgent";

export type TicketStatus =
  | "new"
  | "assigned"
  | "in_progress"
  | "waiting_customer"
  | "waiting_internal"
  | "escalated"
  | "resolved"
  | "closed"
  | "cancelled";

export type CommentVisibility = "public" | "internal";
export type AttachmentVisibility = "public" | "internal";

export interface TenantScopedEntity {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketFormInput {
  submitterName: string;
  companyName: string;
  department: string;
  subject: string;
  priority: TicketPriority;
  description: string;
  attachments?: TicketAttachmentInput[];
}

export interface TicketAttachmentInput {
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface TicketSummary extends TenantScopedEntity {
  ticketNumber?: string;
  createdByUserId: string;
  submitterName: string;
  companyName: string;
  department: string;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignedAgentId?: string;
  resolvedAt?: string;
  closedAt?: string;
}

export interface TicketComment extends TenantScopedEntity {
  ticketId: string;
  authorUserId: string;
  visibility: CommentVisibility;
  body: string;
}

export interface TicketAttachmentMetadata {
  id: string;
  ticketId: string;
  tenantId: string;
  uploadedByUserId: string;
  visibility: AttachmentVisibility;
  bucket: "ticket-attachments";
  storagePath: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt: string;
}
