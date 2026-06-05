export type AppRole = "customer_user" | "customer_manager" | "support_agent" | "admin";
export type UserRole = AppRole;

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
