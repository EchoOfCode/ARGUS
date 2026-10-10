import { NextRequest, NextResponse } from "next/server";
import { brainFetch } from "@/lib/brain";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pending";
  try {
    const res = await brainFetch(`/api/ui/approvals?status=${encodeURIComponent(status)}`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
