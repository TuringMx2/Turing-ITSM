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

// Workers daily tasks ---------------------------------------------------------
export const taskStatusSchema = z.enum(["todo", "doing", "done", "blocked"]);
export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export const dailyCheckinSchema = z.object({
  q1Yesterday: z.string().trim().min(1).max(1000),
  q2Today: z.string().trim().min(1).max(1000),
  q3Blockers: z.string().trim().max(1000).optional().nullable(),
});

export const updateDailyCheckinSchema = dailyCheckinSchema.partial().extend({
  id: z.string().uuid().optional(),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional().nullable(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  id: z.string().uuid(),
});

export const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  status: taskStatusSchema.optional().default("todo"),
  priority: taskPrioritySchema.optional().default("medium"),
  assigneeId: z.string().uuid().optional().nullable(),
});

export const updateTaskStatusSchema = z.object({
  taskId: z.string().uuid(),
  status: taskStatusSchema,
});

export const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.string().uuid().optional().nullable(),
});

export const listDailyCheckinsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: z.string().uuid().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});

export const listTasksSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.string().uuid().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});

export type DailyCheckinInput = z.infer<typeof dailyCheckinSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
