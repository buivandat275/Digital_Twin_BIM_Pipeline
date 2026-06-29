import React, { useRef, useState } from "react";
import { Download, FileUp, Upload } from "lucide-react";
import { parseAssetRegisterFile } from "../../core/services/assetRegisterImportService.js";

export function AssetRegisterImportPanel({ buildings, onImport }) {
  const inputRef = useRef(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");

  async function handleFile(file) {
    if (!file) return;
    setError("");
    setJob(null);
    try {
      const result = await parseAssetRegisterFile(file, buildings);
      setJob({
        fileName: file.name,
        importedAt: new Date().toISOString(),
        ...result,
      });
    } catch (readError) {
      setError(readError.message || "Cannot read asset register.");
    }
  }

  function commitImport() {
    if (!job || job.errors.length) return;
    onImport(job.assets, job);
    setJob(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section className="integration-import-panel" aria-label="Asset register import">
      <div className="integration-import-actions">
        <button onClick={() => inputRef.current?.click()} type="button">
          <FileUp size={16} />
          <span>Import register</span>
        </button>
        <a href="/sample-asset-register.csv">
          <Download size={16} />
          <span>CSV template</span>
        </a>
      </div>
      <input
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="integration-file-input"
        onChange={(event) => handleFile(event.target.files?.[0])}
        ref={inputRef}
        type="file"
      />

      {error ? <p className="integration-import-error">{error}</p> : null}

      {job ? (
        <div className="integration-import-result">
          <div className="integration-import-summary">
            <strong>{job.fileName}</strong>
            {job.sheetName ? <span>Sheet: {job.sheetName}</span> : null}
            <span>{job.summary.validRows}/{job.summary.totalRows} valid rows</span>
            <span>{job.errors.length} errors</span>
          </div>

          {job.errors.length ? (
            <div className="integration-import-issues">
              {job.errors.slice(0, 4).map((issue, index) => (
                <span key={`${issue.row}-${issue.field}-${index}`}>
                  Row {issue.row}: {issue.message}
                </span>
              ))}
            </div>
          ) : (
            <button className="integration-import-commit" onClick={commitImport} type="button">
              <Upload size={16} />
              <span>Merge {job.assets.length} assets</span>
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
