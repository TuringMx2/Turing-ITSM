export type AppRole = "support_agent" | "admin";
export type UserRole = AppRole;

export type TaskStatus = "todo" | "doing" | "done" | "blocked";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  createdBy: string;
  createdAt: string;
  archivedAt?: string | null;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  createdAt: string;
}

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
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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
