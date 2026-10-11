import { NextResponse } from "next/server";
import { brainFetch } from "@/lib/brain";

export async function DELETE(
  _req: Request,
  { params }: { params: { jid: string } }
) {
  try {
    const res = await brainFetch(`/api/ui/contacts/${params.jid}`, {
      method: "DELETE",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
