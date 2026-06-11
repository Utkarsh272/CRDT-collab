"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, getDisplayName } from "@/app/lib/supabase";
import { api } from "@/app/lib/api";
import { DocumentList } from "@/app/components/document-list";
import type { Session } from "@supabase/supabase-js";

export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverOk, setServerOk] = useState<boolean | null>(null);

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

    // Ping ws-server health
    api.health().then(() => setServerOk(true)).catch(() => setServerOk(false));

    return () => subscription.unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  const userName = getDisplayName(session.user);

  return (
    <div className="flex h-screen bg-surface">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col border-r border-border bg-surface-1">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded bg-accent flex items-center justify-center">
              <span className="text-white text-xs font-bold">C</span>
            </div>
            <span className="text-sm font-semibold">Collab</span>
            {serverOk === false && (
              <span className="ml-auto text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">
                server offline
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                <span className="text-accent text-xs font-medium">
                  {userName.slice(0, 1).toUpperCase()}
                </span>
              </div>
              <span className="text-xs text-muted truncate">{userName}</span>
            </div>
            <button
              onClick={() => supabase.auth.signOut().then(() => router.push("/login"))}
              className="text-xs text-muted hover:text-white transition-colors flex-shrink-0"
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <DocumentList
            token={session.access_token}
            onDocumentCreated={(id) => router.push(`/docs/${id}`)}
          />
        </div>
      </aside>

      {/* Empty state */}
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3 max-w-sm">
          <div className="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center mx-auto">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6 text-muted">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-medium">Select a document</h2>
            <p className="text-xs text-muted mt-1">
              Pick one from the sidebar or create a new one to start collaborating.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {["Multi-cursor", "Offline sync", "CRDT-powered"].map((f) => (
              <span key={f} className="px-2.5 py-1 bg-surface-2 border border-border rounded-full text-xs text-muted">{f}</span>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
