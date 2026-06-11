"use client";

import { cn } from "@/app/lib/utils";

export type ConnectionStatus = "connecting" | "synced" | "syncing" | "offline";

const config: Record<ConnectionStatus, { label: string; dot: string; text: string }> = {
  connecting: { label: "Connecting", dot: "bg-yellow-500 animate-pulse", text: "text-yellow-400" },
  synced:     { label: "Synced",     dot: "bg-emerald-500",              text: "text-emerald-400" },
  syncing:    { label: "Syncing",    dot: "bg-blue-500 animate-pulse",   text: "text-blue-400" },
  offline:    { label: "Offline",    dot: "bg-red-500",                  text: "text-red-400" },
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const { label, dot, text } = config[status];
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("w-2 h-2 rounded-full flex-shrink-0", dot)} />
      <span className={cn("text-xs font-medium", text)}>{label}</span>
    </div>
  );
}
