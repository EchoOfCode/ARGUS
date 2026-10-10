import { NextRequest, NextResponse } from "next/server";
import { brainFetch } from "@/lib/brain";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { jid: string } }
) {
  try {
    const body = await request.json();
    const res = await brainFetch(`/api/ui/contacts/${encodeURIComponent(params.jid)}/tier`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
