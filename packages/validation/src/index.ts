import { z } from "zod";

export const ticketPrioritySchema = z.enum(["low", "moderate", "high", "urgent"]);

export const ticketAttachmentInputSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

export const createTicketSchema = z.object({
  submitterName: z.string().trim().min(1).max(160),
  companyName: z.string().trim().min(1).max(160),
  department: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(3).max(180),
  priority: ticketPrioritySchema,
  description: z.string().trim().min(10).max(8000),
  attachments: z.array(ticketAttachmentInputSchema).max(10).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type TicketPriorityInput = z.infer<typeof ticketPrioritySchema>;
export type TicketAttachmentInput = z.infer<typeof ticketAttachmentInputSchema>;
