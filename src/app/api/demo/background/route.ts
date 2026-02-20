import { inngest } from '@/inngest/client';
import { NextResponse } from 'next/server';

export async function POST() {
    await inngest.send({
        name: "demo/generate",
        data: {},
    });
    return NextResponse.json({ message: "Background job sent" });
}