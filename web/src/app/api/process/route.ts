import { NextRequest } from "next/server";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY!;
const LEADMAGIC_API_KEY = process.env.LEADMAGIC_API_KEY!;
const APP_PASSWORD = process.env.APP_PASSWORD!;

async function searchContactInInstantly(firstName: string, lastName: string): Promise<boolean> {
  try {
    const response = await fetch("https://api.instantly.ai/api/v2/leads/list", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INSTANTLY_API_KEY}`,
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

const CONCURRENCY = parseInt(process.env.CONCURRENCY || "10", 10);

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const total = rows.length;
      let completed = 0;
      const resultSlots: { row: Record<string, string>; included: boolean }[] = new Array(total);

      async function processRow(i: number) {
        const row = rows[i];
        const firstName = (row["First Name"] || "").trim();
        const lastName = (row["Last Name"] || "").trim();

        const progress: any = { current: ++completed, total, name: `${firstName} ${lastName}`.trim(), status: "", email: "" };

        if (!firstName && !lastName) {
          row["email"] = "";
          progress.status = "included";
          resultSlots[i] = { row, included: true };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
          return;
        }

        const exists = await searchContactInInstantly(firstName, lastName);

        if (exists) {
          progress.status = "excluded";
          resultSlots[i] = { row, included: false };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        } else {
          const linkedinUrl = (row["Linkedin"] || "").trim();
          let email = "";
          if (linkedinUrl) email = await findPersonalEmail(linkedinUrl);

          row["email"] = email;
          progress.status = "included";
          progress.email = email;
          resultSlots[i] = { row, included: true };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        }
      }

      // Run with concurrency pool
      let idx = 0;
      async function worker() {
        while (idx < total) {
          const i = idx++;
          await processRow(i);
        }
      }

      const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker());
      await Promise.all(workers);

      const included = resultSlots.filter((r) => r.included).map((r) => r.row);
      const columns = Object.keys(rows[0] || {});
      if (!columns.includes("email")) columns.push("email");
      const outputCsv = stringify(included, { header: true, columns });

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ done: true, csv: outputCsv, total, included: included.length, excluded: total - included.length })}\n\n`)
      );
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
