import { NextRequest, NextResponse } from "next/server";
import { brainFetch } from "@/lib/brain";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const res = await brainFetch(`/api/ui/memory/${encodeURIComponent(params.id)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
