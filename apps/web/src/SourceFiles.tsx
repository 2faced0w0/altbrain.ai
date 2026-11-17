import { useState } from "react";
import type { SourceAsset, ConversationPage } from "./api";
import * as api from "./api";
import "./sources.css";
import { Button } from "./ui/Button";

const errors: Record<string, string> = {
  empty_text: "No readable text was found.",
  text_too_long:
    "Extracted text exceeds 20,000 characters. Split it into smaller files.",
  invalid_email: "This email could not be read safely.",
  unsupported_email_body:
    "Use an email with a single plain-text body. HTML, multipart emails and attachments are not supported yet.",
  unsupported_encoding: "Save this email as UTF-8 plain text.",
  invalid_text: "This file contains unsupported control characters.",
};
export function SourceFiles({
  page,
  busy,
  onUpload,
  onReview,
  canReview = true,
}: {
  page: ConversationPage;
  busy: boolean;
  canReview?: boolean;
  onUpload: (file: File) => void;
  onReview: (asset: SourceAsset) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [reading, setReading] = useState(false);
  async function read(asset: SourceAsset, download = false) {
    setReading(true);
    setError("");
    try {
      if (download) await api.downloadSource(asset);
      else {
        const result = await api.sourceText(asset.id);
        setPreview({ id: asset.id, text: result.text });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }
  return (
    <section className="source-files" aria-label="Private source files">
      <div>
        <h3>Bring a file into the conversation</h3>
        <p>
          UTF-8 .txt, .md or plain-text .eml · up to 256 KB. Text stays private
          in this local workspace. Uploading creates no tasks.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (file) onUpload(file);
        }}
      >
        <label htmlFor="source-file">Choose a source file</label>
        <input
          id="source-file"
          type="file"
          accept=".txt,.md,.eml"
          disabled={busy}
          onChange={(e) => {
            const selected = e.target.files?.[0] || null;
            if (
              selected &&
              (!/\.(txt|md|eml)$/i.test(selected.name) ||
                !selected.size ||
                selected.size > 262144)
            ) {
              setError(
                "Choose a nonempty .txt, .md or .eml file up to 256 KB.",
              );
              setFile(null);
            } else {
              setError("");
              setFile(selected);
            }
          }}
        />
        <Button variant="secondary" type="submit" disabled={busy || !file}>
          Upload privately
        </Button>
      </form>
      {error && (
        <p role="alert" className="source-file-error">
          {error}
        </p>
      )}
      {(page.sources || []).map((asset) => {
        const reviewed = page.runs.some(
          (run) =>
            run.source_asset_id === asset.id && run.state === "completed",
        );
        return (
          <article
            className="source-file"
            key={asset.id}
            aria-label={`Source file: ${asset.filename}`}
          >
            <div className="source-file-heading">
              <strong>{asset.filename}</strong>
              <span>
                {(asset.byte_size / 1024).toFixed(1)} KB ·{" "}
                {asset.state === "ready" ? "Text ready" : "Extraction failed"}
              </span>
            </div>
            {asset.state === "failed" ? (
              <p role="status">
                {errors[asset.error_code || ""] ||
                  "Extraction failed. Choose another file."}{" "}
                No task proposals were created; this original is quarantined.
              </p>
            ) : (
              <>
                <div className="source-file-actions">
                  <Button
                    variant="secondary"
                    disabled={busy || reading}
                    onClick={() => void read(asset)}
                  >
                    View extracted text
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy || reading}
                    onClick={() => void read(asset, true)}
                  >
                    Download original
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy || reviewed || !canReview}
                    onClick={() => onReview(asset)}
                  >
                    {reviewed
                      ? "Proposals saved below"
                      : "Review file proposals"}
                  </Button>
                </div>
                {preview?.id === asset.id && (
                  <details open>
                    <summary>
                      Extracted text · treated as source material
                    </summary>
                    <pre>{preview.text}</pre>
                  </details>
                )}
              </>
            )}
          </article>
        );
      })}
      <small>
        PDF, Word, images, HTML and email attachments are not supported yet.
        Extracted text is limited to 20,000 characters; files are retained
        locally for this development build.
      </small>
    </section>
  );
}
