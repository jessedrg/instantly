import { NextRequest } from "next/server";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY!;
const LEADMAGIC_API_KEY = process.env.LEADMAGIC_API_KEY!;
const APP_PASSWORD = process.env.APP_PASSWORD!;
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "20", 10);

// Pre-load ALL Instantly leads into a lookup map via pagination
async function loadAllInstantlyLeads(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor: string | undefined;
  let pages = 0;
  const MAX_PAGES = 200;

  while (pages < MAX_PAGES) {
    try {
      const body: any = { limit: 100 };
      if (cursor) body.starting_after = cursor;

      const res = await fetch("https://api.instantly.ai/api/v2/leads/list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${INSTANTLY_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) break;

      const data = await res.json();
      const items = data.items ?? [];

      for (const lead of items) {
        const fn = (lead.first_name || "").trim().toLowerCase();
        const ln = (lead.last_name || "").trim().toLowerCase();
        if (fn || ln) {
          map.set(`${fn}|${ln}`, lead.email || "");
        }
      }

      if (!data.next_starting_after || items.length < 100) break;
      cursor = data.next_starting_after;
      pages++;
    } catch {
      break;
    }
  }

  return map;
}

async function findPersonalEmail(profileUrl: string): Promise<string> {
  try {
    const response = await fetch("https://api.leadmagic.io/v1/people/personal-email-finder", {
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

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const password = formData.get("password") as string;
  const file = formData.get("file") as File;
  const skipNames = formData.get("skipNames") as string || "";

  if (password !== APP_PASSWORD) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  if (!file) {
    return new Response(JSON.stringify({ error: "No file provided" }), { status: 400 });
  }

  const csvText = await file.text();
  const rows: Record<string, string>[] = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  // Parse skip set (already processed names from previous run)
  const skipSet = new Set<string>(skipNames ? skipNames.split("|||") : []);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      }

      const total = rows.length;

      if (total === 0) {
        send({ done: true, csv: "", total: 0, included: 0, fromInstantly: 0 });
        controller.close();
        return;
      }

      // Phase 1: Pre-load all Instantly leads
      send({ phase: "loading", message: "Cargando leads de Instantly..." });

      const instantlyMap = await loadAllInstantlyLeads();

      send({ phase: "loading", message: `${instantlyMap.size} leads cargados. Procesando ${total} filas...` });

      // Phase 2: Instant matching (synchronous, all at once)
      let fromInstantly = 0;
      let counter = 0;
      const effectiveTotal = total - skipSet.size;
      const needLeadMagic: { row: Record<string, string>; idx: number }[] = [];
      const allResults: Record<string, string>[] = [];

      for (let i = 0; i < total; i++) {
        const row = rows[i];
        const firstName = (row["First Name"] || "").trim();
        const lastName = (row["Last Name"] || "").trim();
        const fullKey = `${firstName}|${lastName}`;

        if (skipSet.has(fullKey)) continue;

        const key = `${firstName.toLowerCase()}|${lastName.toLowerCase()}`;
        const instantlyEmail = (firstName && lastName) ? instantlyMap.get(key) : undefined;

        if (instantlyEmail !== undefined) {
          row["email"] = instantlyEmail;
          fromInstantly++;
          allResults.push(row);
          send({
            current: ++counter,
            total: effectiveTotal,
            name: `${firstName} ${lastName}`.trim(),
            status: "instantly",
            email: instantlyEmail,
            row,
          });
        } else {
          needLeadMagic.push({ row, idx: i });
        }
      }

      send({ phase: "loading", message: `${fromInstantly} en Instantly. Enriqueciendo ${needLeadMagic.length} con LeadMagic...` });

      // Phase 3: LeadMagic enrichment (only for leads NOT in Instantly)
      let lmIdx = 0;
      async function enrichWorker() {
        while (lmIdx < needLeadMagic.length) {
          const j = lmIdx++;
          const { row } = needLeadMagic[j];
          const firstName = (row["First Name"] || "").trim();
          const lastName = (row["Last Name"] || "").trim();
          const linkedinUrl = (row["Linkedin"] || "").trim();
          let email = "";
          if (linkedinUrl) email = await findPersonalEmail(linkedinUrl);

          row["email"] = email;
          allResults.push(row);
          send({
            current: ++counter,
            total: effectiveTotal,
            name: `${firstName} ${lastName}`.trim(),
            status: "leadmagic",
            email,
            row,
          });
        }
      }

      const workers = Array.from({ length: Math.min(CONCURRENCY, needLeadMagic.length || 1) }, () => enrichWorker());
      await Promise.all(workers);

      const columns = Object.keys(rows[0] || {});
      if (!columns.includes("email")) columns.push("email");
      const outputCsv = stringify(allResults, { header: true, columns });

      send({ done: true, csv: outputCsv, total: effectiveTotal, included: allResults.length, fromInstantly });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
