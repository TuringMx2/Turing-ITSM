"use server";

import { createClient } from "@/utils/supabase/server";
import { dailyCheckinSchema, listDailyCheckinsSchema } from "@turing-itsm/validation";
import { revalidatePath } from "next/cache";

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export type DailyActionResult<T = unknown> = { data?: T; error?: string };

export async function createDailyCheckin(input: {
  q1Yesterday: string;
  q2Today: string;
  q3Blockers?: string | null;
}): Promise<DailyActionResult> {
  const parsed = dailyCheckinSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { error: "Unauthorized" };

  const date = todayUTC();
  const payload = {
    user_id: user.id,
    date,
    q1_yesterday: parsed.data.q1Yesterday,
    q2_today: parsed.data.q2Today,
    q3_blockers: parsed.data.q3Blockers ?? null,
  };

  // Check existing for today
  const { data: existing } = await supabase
    .from("daily_checkins")
    .select("id")
    .eq("user_id", user.id)
    .eq("date", date)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("daily_checkins")
      .update({
        q1_yesterday: payload.q1_yesterday,
        q2_today: payload.q2_today,
        q3_blockers: payload.q3_blockers,
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) return { error: error.message };
    revalidatePath("/daily");
    return { data };
  }

  const { data, error } = await supabase.from("daily_checkins").insert(payload).select().single();

  if (error) {
    // Race on unique constraint (23505) -> treat as update
    if (error.code === "23505") {
      const { data: updated, error: updateError } = await supabase
        .from("daily_checkins")
        .update({
          q1_yesterday: payload.q1_yesterday,
          q2_today: payload.q2_today,
          q3_blockers: payload.q3_blockers,
        })
        .eq("user_id", user.id)
        .eq("date", date)
        .select()
        .single();
      if (updateError) return { error: updateError.message };
      revalidatePath("/daily");
      return { data: updated };
    }
    return { error: error.message };
  }

  revalidatePath("/daily");
  return { data };
}

export async function updateDailyCheckin(input: {
  id: string;
  q1Yesterday?: string;
  q2Today?: string;
  q3Blockers?: string | null;
}): Promise<DailyActionResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { error: "Unauthorized" };
  const userId = auth.user.id;

  // Verify ownership and same-day constraint (RLS also enforces, but friendly error)
  const { data: existing, error: fetchError } = await supabase
    .from("daily_checkins")
    .select("id, user_id, date")
    .eq("id", input.id)
    .single();

  if (fetchError || !existing) return { error: "Check-in not found" };
  if (existing.user_id !== userId) return { error: "Forbidden" };

  const today = todayUTC();
  if (existing.date !== today) {
    return { error: "Can only edit today's check-in until 23:59 UTC" };
  }

  const updates: Record<string, string | null> = {};
  if (input.q1Yesterday !== undefined) updates.q1_yesterday = input.q1Yesterday;
  if (input.q2Today !== undefined) updates.q2_today = input.q2Today;
  if (input.q3Blockers !== undefined) updates.q3_blockers = input.q3Blockers;

  if (Object.keys(updates).length === 0) return { error: "No fields to update" };

  // Validate if provided q fields respect length via schema partial
  const partialCheck = dailyCheckinSchema.partial().safeParse({
    q1Yesterday: updates.q1_yesterday,
    q2Today: updates.q2_today,
    q3Blockers: updates.q3_blockers,
  });
  if (!partialCheck.success) {
    return { error: partialCheck.error.issues.map((issue) => issue.message).join(", ") };
  }

  const { data, error } = await supabase
    .from("daily_checkins")
    .update(updates)
    .eq("id", input.id)
    .select()
    .single();

  if (error) return { error: error.message };
  revalidatePath("/daily");
  return { data };
}

export async function listDailyCheckins(input?: {
  date?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
}): Promise<DailyActionResult> {
  const parsed = listDailyCheckinsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { error: "Unauthorized" };
  const currentUserId = auth.user.id;

  // Resolve role to enforce admin vs agent filtering
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", currentUserId).maybeSingle();
  const isAdmin = profile?.role === "admin";

  let targetUserId = parsed.data.userId;
  if (!isAdmin) {
    // Non-admin can only see own regardless of requested userId
    targetUserId = currentUserId;
  } else if (!targetUserId) {
    // Admin without filter: show all (no user_id filter)
    targetUserId = undefined;
  }

  const { date, page = 1, pageSize = 20 } = parsed.data;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("daily_checkins")
    .select("*", { count: "exact" })
    .order("date", { ascending: false })
    .range(from, to);

  if (targetUserId) query = query.eq("user_id", targetUserId);
  if (date) query = query.eq("date", date);

  const { data, error, count } = await query;
  if (error) return { error: error.message };

  return { data: { rows: data, count, page, pageSize } };
}

export async function getTodayCheckin(): Promise<DailyActionResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { error: "Unauthorized" };

  const date = todayUTC();
  const { data, error } = await supabase
    .from("daily_checkins")
    .select("*")
    .eq("user_id", auth.user.id)
    .eq("date", date)
    .maybeSingle();

  if (error) return { error: error.message };
  return { data };
}
