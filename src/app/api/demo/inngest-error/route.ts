import { inngest } from "@/inngest/client";
import { NextResponse } from "next/server";

export async function POST() {
    await inngest.send({
        name: "demo/error",
        data: {}
    });
    return NextResponse.json({ status: "started" });
}