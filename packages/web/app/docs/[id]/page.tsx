"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase, getDisplayName } from "@/app/lib/supabase";
import { api, type Document } from "@/app/lib/api";
import { CollaborativeEditor } from "@/app/components/collaborative-editor";
import { ShareDialog } from "@/app/components/share-dialog";
import { DocumentList } from "@/app/components/document-list";
import { Share2, ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";

// Deterministic color — same algorithm as ws-server/src/server.ts
function deterministicColor(userId: string): string {
  const palette = ["#f97316","#3b82f6","#10b981","#a855f7","#ef4444","#eab308","#06b6d4","#ec4899"];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

export default function DocPage() {
  const params = useParams();
  const router = useRouter();
  const docId = params.id as string;

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState<Document | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (!data.session) router.push("/login");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, sess) => {
      setSession(sess);
      if (!sess) router.push("/login");
    });
    return () => subscription.unsubscribe();
  }, [router]);

  // Load document metadata
  useEffect(() => {
    if (!session || !docId) return;
    api.documents.get(session.access_token, docId)
      .then((d) => { setDoc(d); setTitleDraft(d.title); })
      .catch(() => router.push("/"));
  }, [session, docId, router]);

  const saveTitle = useCallback(async () => {
    setEditingTitle(false);
    if (!session || !doc || titleDraft === doc.title || !titleDraft.trim()) {
      setTitleDraft(doc?.title ?? "");
      return;
    }
    try {
      const updated = await api.documents.update(session.access_token, docId, titleDraft.trim());
      setDoc(updated);
    } catch {
      setTitleDraft(doc.title);
    }
  }, [session, doc, docId, titleDraft]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  const userName = getDisplayName(session.user);
  const userColor = deterministicColor(session.user.id);
  const token = session.access_token;

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      {/* Sidebar — hidden on mobile */}
      <aside className="w-56 flex-shrink-0 flex-col border-r border-border bg-surface-1 hidden md:flex">
        <div className="px-3 py-3 border-b border-border flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-5 h-5 rounded bg-accent flex items-center justify-center">
              <span className="text-white text-xs font-bold">C</span>
            </div>
            <span className="text-xs font-semibold group-hover:text-white/80 transition-colors">Collab</span>
          </Link>
        </div>
        <div className="flex-1 overflow-hidden">
          <DocumentList
            token={token}
            activeDocId={docId}
            onDocumentCreated={(id) => router.push(`/docs/${id}`)}
          />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-surface-1 flex-shrink-0">
          <Link href="/" className="md:hidden text-muted hover:text-white transition-colors">
            <ChevronLeft size={18} />
          </Link>

          {/* Editable title */}
          {editingTitle ? (
            <input
              ref={titleRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") { setTitleDraft(doc?.title ?? ""); setEditingTitle(false); }
              }}
              className="flex-1 bg-transparent text-sm font-medium text-white outline-none border-b border-accent pb-0.5 min-w-0"
              autoFocus
            />
          ) : (
            <button
              onClick={() => { setEditingTitle(true); setTimeout(() => titleRef.current?.select(), 10); }}
              className="flex-1 text-left text-sm font-medium text-white hover:text-white/70 transition-colors truncate min-w-0"
              title="Click to rename"
            >
              {doc?.title || "Untitled"}
            </button>
          )}

          <button
            onClick={() => setShareOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface-3 hover:bg-surface-2 rounded-lg transition-colors flex-shrink-0"
          >
            <Share2 size={12} />Share
          </button>
        </header>

        {/* Editor — key={docId} ensures full remount when switching docs */}
        <div className="flex-1 overflow-hidden">
          <CollaborativeEditor
            key={docId}
            docId={docId}
            token={token}
            userName={userName}
            userColor={userColor}
          />
        </div>
      </div>

      {shareOpen && (
        <ShareDialog docId={docId} token={token} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
