import {
  useListDocuments, type Document, type DocumentCategory,
} from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useOpenDocument } from "@/lib/open-document";

const CAT_LABEL: Record<DocumentCategory, string> = {
  spec: "SPC", plan: "PLN", permit: "PMT", vendor: "VEN",
  as_built: "ASB", safety: "SFT", general: "DOC",
};
const CAT_TONE: Record<DocumentCategory, "" | "violet" | "blue" | "amber" | "rose"> = {
  spec: "", plan: "blue", permit: "amber", vendor: "violet",
  as_built: "blue", safety: "rose", general: "",
};
const CAT_FULL: Record<DocumentCategory, string> = {
  spec: "Spec", plan: "Plan", permit: "Permit", vendor: "Vendor",
  as_built: "As-Built", safety: "Safety", general: "Doc",
};

export default function MobileDocuments() {
  const { data: docs, isLoading } = useListDocuments({});
  const open = useOpenDocument();

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
        <div className="mdocgrid">
          {(docs ?? []).map((d) => (
            <DocTile key={d.id} doc={d} onOpen={() => open(d)} />
          ))}
        </div>
      )}
    </>
  );
}

function DocTile({ doc, onOpen }: { doc: Document; onOpen: () => void }) {
  const tone = CAT_TONE[doc.category] ?? "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="tile m-glass"
      data-testid={`mobile-doc-${doc.id}`}
    >
      <div className={`ti ${tone}`}>{CAT_LABEL[doc.category] ?? "DOC"}</div>
      <div className="tn">{doc.title}</div>
      <div className="tc">{CAT_FULL[doc.category] ?? doc.category}</div>
    </button>
  );
}
