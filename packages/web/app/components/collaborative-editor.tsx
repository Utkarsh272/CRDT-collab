"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CharacterCount from "@tiptap/extension-character-count";
import Link from "@tiptap/extension-link";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import { wsUrl } from "@/app/lib/api";
import { EditorToolbar } from "./editor-toolbar";
import { PresenceList, type Collaborator } from "./presence-list";
import { ConnectionStatusBadge, type ConnectionStatus } from "./connection-status";

interface CollaborativeEditorProps {
  docId: string;
  token: string;
  userName: string;
  userColor: string;
}

export function CollaborativeEditor({
  docId,
  token,
  userName,
  userColor,
}: CollaborativeEditorProps) {
  // We hold ydoc + provider in refs so editor extensions can access them
  // synchronously on first render (useEditor runs once on mount).
  const ydocRef = useRef<Y.Doc>(new Y.Doc());
  const providerRef = useRef<WebsocketProvider | null>(null);
  const idbRef = useRef<IndexeddbPersistence | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [wordCount, setWordCount] = useState(0);

  // Set up providers on mount; tear down on unmount or docId change
  useEffect(() => {
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    // 1. IndexedDB — loads local edits immediately (offline-first)
    const idb = new IndexeddbPersistence(`crdt:${docId}`, ydoc);
    idbRef.current = idb;
    idb.on("synced", () => console.log("[idb] local state loaded"));

    // 2. WebSocket provider — real-time sync with the server
    // y-websocket prepends the room name to the WS URL itself,
    // so we pass the base URL and room separately.
    const baseWsUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:1234")
      .replace(/^http/, "ws");

    const provider = new WebsocketProvider(baseWsUrl, docId, ydoc, {
      connect: true,
      params: { token },   // token forwarded as query param on WS upgrade
    });
    providerRef.current = provider;

    provider.awareness.setLocalStateField("user", { name: userName, color: userColor });

    provider.on("status", ({ status: s }: { status: string }) => {
      if (s === "connected") setStatus("synced");
      else if (s === "connecting") setStatus("connecting");
      else setStatus("offline");
    });

    provider.on("sync", (synced: boolean) => setStatus(synced ? "synced" : "syncing"));

    const updateCollabs = () => {
      const states = provider.awareness.getStates();
      const collabs: Collaborator[] = [];
      states.forEach((state, clientId) => {
        if (clientId === provider.awareness.clientID) return;
        if (state.user) {
          collabs.push({ clientId, name: state.user.name as string, color: state.user.color as string });
        }
      });
      setCollaborators(collabs);
    };
    provider.awareness.on("change", updateCollabs);

    return () => {
      provider.awareness.off("change", updateCollabs);
      provider.destroy();
      idb.destroy();
      ydoc.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, token]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }), // Yjs manages undo/redo
      Collaboration.configure({ document: ydocRef.current }),
      CollaborationCursor.configure({
        provider: providerRef.current!,
        user: { name: userName, color: userColor },
      }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CharacterCount,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
    ],
    editorProps: {
      attributes: { class: "tiptap-editor", spellcheck: "true" },
    },
    onUpdate: ({ editor: e }) => {
      setWordCount(e.storage.characterCount.words() as number);
    },
    immediatelyRender: false, // avoid SSR hydration mismatch
  });

  // When docId changes, update Collaboration extension's document reference
  useEffect(() => {
    if (editor && ydocRef.current) {
      // Tiptap doesn't support swapping the ydoc live; the component
      // key={docId} on the parent ensures a full remount instead.
    }
  }, [editor, docId]);

  return (
    <div className="flex flex-col h-full">
      {/* Presence + status bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface-1 flex-shrink-0">
        <PresenceList collaborators={collaborators} />
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted tabular-nums">
            {wordCount.toLocaleString()} words
          </span>
          <ConnectionStatusBadge status={status} />
        </div>
      </div>

      {/* Toolbar */}
      <EditorToolbar editor={editor} />

      {/* Editor */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
