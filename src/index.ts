import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join, resolve, basename } from "path";
import "dotenv/config";

const API_KEY = process.env.INSTANTLY_API_KEY!;
const LEADMAGIC_API_KEY = process.env.LEADMAGIC_API_KEY!;
const INPUT_DIR = resolve(process.env.INPUT_DIR || "input");
const OUTPUT_DIR = resolve(process.env.OUTPUT_DIR || "output");
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "10", 10);
const INSTANTLY_BASE_URL = "https://api.instantly.ai/api/v2";
const LEADMAGIC_URL = "https://api.leadmagic.io/v1/people/personal-email-finder";

async function searchContactInInstantly(firstName: string, lastName: string): Promise<boolean> {
  try {
    const response = await fetch(`${INSTANTLY_BASE_URL}/leads/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ search: firstName, limit: 100 }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    const items = data.items ?? [];

    return items.some(
      (lead: any) =>
        lead.first_name?.toLowerCase() === firstName.toLowerCase() &&
        lead.last_name?.toLowerCase() === lastName.toLowerCase()
    );
  } catch {
    return false;
  }
}

async function findPersonalEmail(profileUrl: string): Promise<string> {
  try {
    const response = await fetch(LEADMAGIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": LEADMAGIC_API_KEY,
      },
      body: JSON.stringify({ profile_url: profileUrl }),
    });

    if (!response.ok) return "";

    const data = await response.json();
    return data.first_personal_email || "";
  } catch {
    return "";
  }
}

async function processRow(row: Record<string, string>, index: number, total: number): Promise<{ row: Record<string, string>; included: boolean }> {
  const firstName = (row["First Name"] || "").trim();
  const lastName = (row["Last Name"] || "").trim();

  if (!firstName && !lastName) {
    console.log(`  [${index}/${total}] Sin nombre → incluido`);
    row["email"] = "";
    return { row, included: true };
  }

  const exists = await searchContactInInstantly(firstName, lastName);

  if (exists) {
    console.log(`  [${index}/${total}] ${firstName} ${lastName} → excluido`);
    return { row, included: false };
  }

  const linkedinUrl = (row["Linkedin"] || "").trim();
  let email = "";

  if (linkedinUrl) {
    email = await findPersonalEmail(linkedinUrl);
    console.log(`  [${index}/${total}] ${firstName} ${lastName} → incluido ${email ? `✉ ${email}` : "(sin email)"}`);
  } else {
    console.log(`  [${index}/${total}] ${firstName} ${lastName} → incluido (sin LinkedIn)`);
  }

  row["email"] = email;
  return { row, included: true };
}

async function runBatch<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function getCsvFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => join(dir, f));
}

async function main() {
  if (!API_KEY) { console.error("Falta INSTANTLY_API_KEY"); process.exit(1); }
  if (!LEADMAGIC_API_KEY) { console.error("Falta LEADMAGIC_API_KEY"); process.exit(1); }

  const csvFiles = getCsvFiles(INPUT_DIR);
  if (csvFiles.length === 0) { console.error(`No CSVs en: ${INPUT_DIR}`); process.exit(1); }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`📂 Input: ${INPUT_DIR}`);
  console.log(`📂 Output: ${OUTPUT_DIR}`);
  console.log(`⚡ Concurrencia: ${CONCURRENCY}`);
  console.log(`📄 Archivos: ${csvFiles.length}\n`);

  let totalProcessed = 0, totalExcluded = 0, totalIncluded = 0;

  for (const file of csvFiles) {
    console.log(`▶ ${basename(file)}`);
    const csvContent = readFileSync(file, "utf-8");
    const rows: Record<string, string>[] = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
    const total = rows.length;

    const startTime = Date.now();

    const results = await runBatch(
      rows.map((row, i) => ({ row, index: i + 1 })),
      CONCURRENCY,
      ({ row, index }) => processRow(row, index, total)
    );

    const included = results.filter((r) => r.included).map((r) => r.row);
    totalProcessed += total;
    totalExcluded += total - included.length;
    totalIncluded += included.length;

    const columns = Object.keys(rows[0] || {});
    if (!columns.includes("email")) columns.push("email");
    const output = stringify(included, { header: true, columns });

    const outputPath = join(OUTPUT_DIR, basename(file));
    writeFileSync(outputPath, output, "utf-8");

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ✅ ${included.length}/${total} incluidos en ${elapsed}s → ${outputPath}\n`);
  }

  console.log(`════════════════════════════════════`);
  console.log(`Total: ${totalProcessed} | Excluidos: ${totalExcluded} | Incluidos: ${totalIncluded}`);
}

main().catch(console.error);
