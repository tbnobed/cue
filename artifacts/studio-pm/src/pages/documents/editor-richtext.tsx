import { useEffect, useRef } from "react";
import * as Y from "yjs";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import {
  Bold, Italic, List, ListOrdered, Heading1, Heading2, Heading3,
  Minus, Undo2, Redo2, Code,
} from "lucide-react";

export function RichTextEditor({
  ydoc,
  seedText,
  seedAsCode,
  placeholder,
}: {
  ydoc: Y.Doc;
  seedText: string | null;
  seedAsCode?: boolean;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: ydoc }),
      Placeholder.configure({
        placeholder: placeholder ?? "Start writing — all editors see changes in real time…",
      }),
      CharacterCount,
    ],
    editorProps: {
      attributes: {
        class: "prose prose-invert max-w-none focus:outline-none min-h-[60vh] px-1",
      },
    },
  }, [ydoc]);

  const seededRef = useRef(false);
  useEffect(() => {
    if (!editor) return;
    if (seededRef.current) return;
    if (!seedText) return;
    // Wait for initial sync from collab server before deciding to seed
    const timer = setTimeout(() => {
      if (seededRef.current) return;
      if (!editor.isEmpty) { seededRef.current = true; return; }
      seededRef.current = true;
      if (seedAsCode) {
        const escaped = seedText.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
        editor.commands.setContent(`<pre><code>${escaped}</code></pre>`);
      } else {
        const html = seedText
          .split(/\r?\n/)
          .map(line => `<p>${line.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)) || "<br>"}</p>`)
          .join("");
        editor.commands.setContent(html);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [editor, seedText, seedAsCode]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 p-2 bg-card border border-border rounded-lg">
        <ToolBtn title="Heading 1" active={editor?.isActive("heading", { level: 1 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
          <Heading1 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Heading 2" active={editor?.isActive("heading", { level: 2 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Heading 3" active={editor?.isActive("heading", { level: 3 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="w-3.5 h-3.5" />
        </ToolBtn>
        <div className="w-px h-6 bg-border mx-1 self-center" />
        <ToolBtn title="Bold" active={editor?.isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}>
          <Bold className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Italic" active={editor?.isActive("italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <Italic className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Code block" active={editor?.isActive("codeBlock")}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>
          <Code className="w-3.5 h-3.5" />
        </ToolBtn>
        <div className="w-px h-6 bg-border mx-1 self-center" />
        <ToolBtn title="Bullet list" active={editor?.isActive("bulletList")}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          <List className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Numbered list" active={editor?.isActive("orderedList")}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Horizontal rule"
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
          <Minus className="w-3.5 h-3.5" />
        </ToolBtn>
        <div className="w-px h-6 bg-border mx-1 self-center" />
        <ToolBtn title="Undo" onClick={() => editor?.chain().focus().undo().run()}>
          <Undo2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Redo" onClick={() => editor?.chain().focus().redo().run()}>
          <Redo2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono self-center pr-1">
          {editor?.storage.characterCount?.characters() ?? 0} chars
        </span>
      </div>

      <div
        className="min-h-[65vh] bg-card border border-border rounded-lg p-6 cursor-text"
        onClick={() => editor?.commands.focus()}
      >
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="flex items-center justify-center h-40 text-muted-foreground font-mono text-sm">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBtn({
  children, onClick, active, title,
}: {
  children: React.ReactNode; onClick: () => void; active?: boolean; title?: string;
}) {
  return (
    <button
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      className={`p-1.5 rounded text-sm transition-colors ${
        active
          ? "bg-primary/20 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
