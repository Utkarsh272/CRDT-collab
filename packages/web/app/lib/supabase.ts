"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export const supabase = createClientComponentClient();

export function getDisplayName(user: {
  email?: string;
  user_metadata?: Record<string, string>;
}): string {
  return (
    user.user_metadata?.full_name ??
    user.user_metadata?.name ??
    user.email?.split("@")[0] ??
    "Anonymous"
  );
}
