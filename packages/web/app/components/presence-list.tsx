"use client";

export interface Collaborator {
  clientId: number;
  name: string;
  color: string;
}

export function PresenceList({ collaborators }: { collaborators: Collaborator[] }) {
  const visible = collaborators.slice(0, 6);
  const overflow = collaborators.length - 6;

  if (collaborators.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {visible.map((c) => (
        <div
          key={c.clientId}
          title={c.name}
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white ring-2 ring-[#0f0f0f] flex-shrink-0"
          style={{ backgroundColor: c.color }}
        >
          {c.name.slice(0, 1).toUpperCase()}
        </div>
      ))}
      {overflow > 0 && (
        <div className="w-7 h-7 rounded-full bg-surface-3 flex items-center justify-center text-xs font-medium text-muted ring-2 ring-[#0f0f0f]">
          +{overflow}
        </div>
      )}
      <span className="text-xs text-muted ml-1">
        {collaborators.length === 1 ? "1 editing" : `${collaborators.length} editing`}
      </span>
    </div>
  );
}
