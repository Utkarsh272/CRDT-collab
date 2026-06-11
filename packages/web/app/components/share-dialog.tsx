"use client";

import { useState } from "react";
import { X, Link2, Mail, Check, Copy } from "lucide-react";
import { api } from "@/app/lib/api";
import { cn } from "@/app/lib/utils";

interface ShareDialogProps {
  docId: string;
  token: string;
  onClose: () => void;
}

export function ShareDialog({ docId, token, onClose }: ShareDialogProps) {
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"read" | "write">("write");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const shareByEmail = async () => {
    if (!email.trim()) return;
    setBusy(true); setMsg(null);
    try {
      await api.documents.shareByEmail(token, docId, email.trim(), permission);
      setMsg({ ok: true, text: `Shared with ${email}` });
      setEmail("");
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const generateLink = async () => {
    setBusy(true);
    try {
      const { link } = await api.documents.createShareLink(token, docId, permission);
      setShareLink(link);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-1 border border-border rounded-xl w-full max-w-md shadow-2xl animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Share document</h2>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Permission toggle */}
          <div className="flex rounded-lg overflow-hidden border border-border">
            {(["write", "read"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPermission(p)}
                className={cn(
                  "flex-1 py-2 text-xs font-medium transition-colors",
                  permission === p ? "bg-accent text-white" : "text-muted hover:text-white hover:bg-surface-3"
                )}
              >
                {p === "write" ? "Can edit" : "Can view"}
              </button>
            ))}
          </div>

          {/* Email invite */}
          <div>
            <label className="block text-xs text-muted mb-2 font-medium">
              <Mail size={11} className="inline mr-1.5" />Invite by email
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && shareByEmail()}
                placeholder="colleague@example.com"
                className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-accent transition-colors"
              />
              <button
                onClick={shareByEmail}
                disabled={!email.trim() || busy}
                className="px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                Invite
              </button>
            </div>
          </div>

          {/* Share link */}
          <div>
            <label className="block text-xs text-muted mb-2 font-medium">
              <Link2 size={11} className="inline mr-1.5" />Share link
            </label>
            {shareLink ? (
              <div className="flex gap-2">
                <input
                  readOnly value={shareLink}
                  className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-muted outline-none"
                />
                <button
                  onClick={copy}
                  className={cn(
                    "px-3 py-2 text-sm rounded-lg flex items-center gap-1.5 transition-colors",
                    copied ? "bg-emerald-600 text-white" : "bg-surface-3 text-white hover:bg-surface-2"
                  )}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <button
                onClick={generateLink}
                disabled={busy}
                className="w-full py-2 border border-border border-dashed rounded-lg text-xs text-muted hover:text-white hover:border-accent transition-colors"
              >
                Generate link
              </button>
            )}
          </div>

          {msg && (
            <p className={cn("text-xs px-3 py-2 rounded-lg", msg.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")}>
              {msg.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
