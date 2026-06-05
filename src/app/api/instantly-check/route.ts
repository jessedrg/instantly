import { NextRequest } from "next/server";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY!;
const APP_PASSWORD = process.env.APP_PASSWORD!;

async function loadAllInstantlyLeads(send: (obj: any) => void): Promise<Map<string, string>> {
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

      send({ phase: "loading", message: `${map.size} leads cargados de Instantly...` });

      if (!data.next_starting_after || items.length < 100) break;
      cursor = data.next_starting_after;
      pages++;
    } catch {
      break;
    }
  }

  return map;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const password = formData.get("password") as string;
  const file = formData.get("file") as File;

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

  // Normalize column names
  const columnMap: Record<string, string> = {
    "LinkedIn": "Linkedin",
    "linkedin": "Linkedin",
    "Email": "email",
    "EMAIL": "email",
    "First name": "First Name",
    "first name": "First Name",
    "Last name": "Last Name",
    "last name": "Last Name",
  };

  for (const row of rows) {
    for (const [from, to] of Object.entries(columnMap)) {
      if (from !== to && row[from] !== undefined && row[to] === undefined) {
        row[to] = row[from];
      }
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      }

      const total = rows.length;

      if (total === 0) {
        send({ done: true, csv: "", total: 0, found: 0 });
        controller.close();
        return;
      }

      send({ phase: "loading", message: "Cargando leads de Instantly..." });

      const instantlyMap = await loadAllInstantlyLeads(send);

      send({ phase: "loading", message: `${instantlyMap.size} leads cargados. Comparando ${total} filas...` });

      // Instant matching — only keep leads found in Instantly
      const foundRows: Record<string, string>[] = [];
      let counter = 0;

      for (let i = 0; i < total; i++) {
        const row = rows[i];
        const firstName = (row["First Name"] || "").trim();
        const lastName = (row["Last Name"] || "").trim();

        if (!firstName && !lastName) continue;

        const key = `${firstName.toLowerCase()}|${lastName.toLowerCase()}`;
        const instantlyEmail = instantlyMap.get(key);

        if (instantlyEmail !== undefined) {
          row["email"] = instantlyEmail;
          foundRows.push(row);
          send({
            current: ++counter,
            total,
            name: `${firstName} ${lastName}`.trim(),
            status: "instantly",
            email: instantlyEmail,
            row,
          });
        }
      }

      const columns = Object.keys(rows[0] || {});
      if (!columns.includes("email")) columns.push("email");
      const outputCsv = stringify(foundRows, { header: true, columns });

      send({ done: true, csv: outputCsv, total, found: foundRows.length });
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
