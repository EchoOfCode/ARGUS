import { NextResponse } from "next/server";
import { brainFetch } from "@/lib/brain";

export async function GET() {
  try {
    const res = await brainFetch("/api/ui/ledger");
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
