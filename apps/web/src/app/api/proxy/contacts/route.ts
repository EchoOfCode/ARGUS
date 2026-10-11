import { NextResponse } from "next/server";
import { brainFetch } from "@/lib/brain";

export async function GET() {
  try {
    const res = await brainFetch("/api/ui/contacts");
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const res = await brainFetch("/api/ui/contacts", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
