import { NextResponse } from "next/server";
import { brainFetch } from "@/lib/brain";

export async function POST() {
  try {
    const res = await brainFetch("/api/ui/contacts/scan-history", {
      method: "POST",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
