"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, FileText, Trash2, Clock, Users } from "lucide-react";
import { api, type Document } from "@/app/lib/api";
import { cn } from "@/app/lib/utils";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface DocumentListProps {
  token: string;
  activeDocId?: string;
  onDocumentCreated?: (id: string) => void;
}

export function DocumentList({ token, activeDocId, onDocumentCreated }: DocumentListProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { documents: docs } = await api.documents.list(token);
      setDocuments(docs);
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const doc = await api.documents.create(token, "Untitled");
      setDocuments((prev) => [doc, ...prev]);
      onDocumentCreated?.(doc.id);
    } catch (err) {
      console.error("Failed to create:", err);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this document? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await api.documents.delete(token, id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-3 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-surface-2 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <button
          onClick={create}
          disabled={creating}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors disabled:opacity-60"
        >
          <Plus size={14} />
          {creating ? "Creating…" : "New document"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4 py-8">
            <FileText size={28} className="text-muted opacity-40" />
            <p className="text-xs text-muted">No documents yet</p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {documents.map((doc) => (
              <li key={doc.id}>
                <Link
                  href={`/docs/${doc.id}`}
                  className={cn(
                    "group flex items-start gap-2.5 p-2.5 rounded-lg transition-colors relative",
                    activeDocId === doc.id
                      ? "bg-surface-3 text-white"
                      : "hover:bg-surface-2 text-white/80 hover:text-white"
                  )}
                >
                  <FileText size={14} className="text-muted flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{doc.title || "Untitled"}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="flex items-center gap-1 text-[10px] text-muted">
                        <Clock size={9} />{timeAgo(doc.updated_at)}
                      </span>
                      {doc.permission && (
                        <span className="flex items-center gap-1 text-[10px] text-muted">
                          <Users size={9} />Shared
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => remove(e, doc.id)}
                    disabled={deletingId === doc.id}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted hover:text-red-400 hover:bg-red-400/10 transition-all"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
