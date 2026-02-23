import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { NextResponse } from 'next/server';

const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
});

export async function POST() {
    const response = await generateText({
        model: openrouter.chat('openrouter/free'),
        prompt: 'Write a short story about a cat.',
        system: "You are a helpful assistant. You are given a prompt for a story and you need to write the most compelling and captivating story you can.",
        experimental_telemetry: {
            isEnabled: true,
            recordInputs: true,
            recordOutputs: true,
        },
    });
    return NextResponse.json({ response });
}