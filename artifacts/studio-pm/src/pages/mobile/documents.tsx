import {
  useListDocuments, type Document, type DocumentCategory,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { ChevronRight, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const CAT_LABEL: Record<DocumentCategory, string> = {
  spec: "SPC", plan: "PLN", permit: "PMT", vendor: "VEN",
  as_built: "ASB", safety: "SFT", general: "DOC",
};
const CAT_TONE: Record<DocumentCategory, "" | "violet" | "blue" | "amber"> = {
  spec: "", plan: "blue", permit: "amber", vendor: "violet",
  as_built: "", safety: "amber", general: "blue",
};

export default function MobileDocuments() {
  const { data: docs, isLoading } = useListDocuments({});

  return (
    <>
      <div className="mhead">
        <div className="k">Document Library</div>
        <h2>All files</h2>
        <p>{isLoading ? "Loading…" : `${docs?.length ?? 0} documents`}</p>
      </div>

      {isLoading ? (
        <div className="m-glass" style={{ padding: 32, textAlign: "center" }}>
          <Loader2 className="w-5 h-5 animate-spin inline" />
        </div>
      ) : (docs ?? []).length === 0 ? (
        <div className="mempty m-glass">
          <div className="orb" />
          <b>No documents yet</b>
          <span>Upload specs, plans, permits, and more from the desktop app.</span>
        </div>
      ) : (
        (docs ?? []).map((d) => <DocRow key={d.id} doc={d} />)
      )}
    </>
  );
}

function DocRow({ doc }: { doc: Document }) {
  const tone = CAT_TONE[doc.category] ?? "";
  const meta = [
    doc.projectName,
    formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true }),
  ].filter(Boolean).join(" · ");

  return (
    <Link
      href={doc.projectId ? `/projects/${doc.projectId}` : "/documents"}
      className="mdoc m-glass"
      data-testid={`mobile-doc-${doc.id}`}
    >
      <div className={`di ${tone}`}>{CAT_LABEL[doc.category] ?? "DOC"}</div>
      <div className="dn">
        <b>{doc.title}</b>
        <div className="m">
          <span className="ty">{doc.category}</span>
          {meta}
        </div>
      </div>
      <div className="go"><ChevronRight /></div>
    </Link>
  );
}
