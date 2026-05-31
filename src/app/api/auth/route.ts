import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const APP_PASSWORD = process.env.APP_PASSWORD;

  if (!APP_PASSWORD) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  if (password === APP_PASSWORD) {
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid password" }, { status: 401 });
}
