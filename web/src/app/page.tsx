"use client";

import { useState, useRef, useCallback } from "react";

interface ProgressItem {
  current: number;
  total: number;
  name: string;
  status: "excluded" | "included" | "";
  email: string;
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState<ProgressItem[]>([]);
  const [summary, setSummary] = useState<{ total: number; included: number; excluded: number } | null>(null);
  const [csvData, setCsvData] = useState<string>("");
  const [currentFile, setCurrentFile] = useState("");
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setAuthenticated(true);
    } else {
      setAuthError("Contraseña incorrecta");
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith(".csv")
    );
    setFiles((prev) => [...prev, ...droppedFiles]);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files).filter((f) =>
        f.name.toLowerCase().endsWith(".csv")
      );
      setFiles((prev) => [...prev, ...selected]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const processFiles = async () => {
    setProcessing(true);
    setLogs([]);
    setSummary(null);
    setCsvData("");

    let allCsv = "";
    let totalSummary = { total: 0, included: 0, excluded: 0 };

    for (const file of files) {
      setCurrentFile(file.name);
      const formData = new FormData();
      formData.append("password", password);
      formData.append("file", file);

      const res = await fetch("/api/process", { method: "POST", body: formData });

      if (!res.ok || !res.body) continue;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = JSON.parse(line.slice(6));

          if (json.done) {
            allCsv += json.csv;
            totalSummary.total += json.total;
            totalSummary.included += json.included;
            totalSummary.excluded += json.excluded;
          } else {
            setLogs((prev) => [...prev, json]);
          }
        }
      }
    }

    setCsvData(allCsv);
    setSummary(totalSummary);
    setProcessing(false);
    setCurrentFile("");
  };

  const downloadCsv = () => {
    const blob = new Blob([csvData], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "filtered_leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!authenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <form onSubmit={handleLogin} className="bg-gray-900 p-8 rounded-2xl shadow-2xl w-full max-w-sm border border-gray-800">
          <h1 className="text-2xl font-bold mb-6 text-center">CSV Lead Filter</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña"
            className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
          />
          {authError && <p className="text-red-400 text-sm mb-4">{authError}</p>}
          <button
            type="submit"
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
          >
            Entrar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 py-12">
      <h1 className="text-3xl font-bold mb-2">CSV Lead Filter</h1>
      <p className="text-gray-400 mb-8">
        Sube CSVs, filtra contra Instantly y enriquece con LeadMagic
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors mb-6 ${
          dragOver ? "border-blue-500 bg-blue-500/10" : "border-gray-700 hover:border-gray-600"
        }`}
      >
        <p className="text-gray-400 mb-3">Arrastra archivos CSV aquí</p>
        <label className="cursor-pointer inline-block px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors">
          O selecciona archivos
          <input type="file" accept=".csv" multiple onChange={handleFileInput} className="hidden" />
        </label>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mb-6 space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between bg-gray-900 px-4 py-2 rounded-lg border border-gray-800">
              <span className="text-sm truncate">{f.name}</span>
              <button onClick={() => removeFile(i)} className="text-gray-500 hover:text-red-400 text-sm ml-4">
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Process button */}
      {files.length > 0 && !processing && (
        <button
          onClick={processFiles}
          className="w-full py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors mb-6"
        >
          Procesar {files.length} archivo{files.length > 1 ? "s" : ""}
        </button>
      )}

      {/* Progress */}
      {processing && (
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-400">
              Procesando: {currentFile} ({logs.length} leads procesados)
            </span>
          </div>
        </div>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6 max-h-80 overflow-y-auto font-mono text-xs">
          {logs.map((log, i) => (
            <div key={i} className="py-0.5">
              <span className="text-gray-500">[{log.current}/{log.total}]</span>{" "}
              <span className="text-white">{log.name}</span>{" "}
              {log.status === "excluded" ? (
                <span className="text-red-400">excluido</span>
              ) : (
                <>
                  <span className="text-green-400">incluido</span>
                  {log.email && <span className="text-blue-400 ml-2">{log.email}</span>}
                </>
              )}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* Summary + Download */}
      {summary && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-3">Resultado</h2>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{summary.total}</div>
              <div className="text-xs text-gray-400">Total</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-400">{summary.excluded}</div>
              <div className="text-xs text-gray-400">En Instantly</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{summary.included}</div>
              <div className="text-xs text-gray-400">Nuevos</div>
            </div>
          </div>
          <button
            onClick={downloadCsv}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors"
          >
            Descargar CSV filtrado
          </button>
        </div>
      )}
    </div>
  );
}
