"use client";

import { useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useState } from "react";
import * as Sentry from "@sentry/nextjs";

export default function DemoPage() {
    const { userId } = useAuth();
    const [loading, setLoading] = useState(false);
    const handleBlocking = async () => {
        setLoading(true);
        await fetch("/api/demo/blocking", { method: "POST" });
        setLoading(false);
    };
    const handleBackground = async () => {
        setLoading(true);
        await fetch("/api/demo/background", { method: "POST" });
        setLoading(false);
    };

    const handleClientError = async () => {
        Sentry.logger.info("User clicked on client function",
            { userId: userId ?? "anonymous" }
        );
        throw new Error("Client error");
    };
    const handleServerError = async () => {
        await fetch("/api/demo/error", { method: "POST" });
    };
    const handleInngestError = async () => {
        await fetch("/api/demo/inngest-error", { method: "POST" });
    };

    return (
        <div className="p-8 space-x-4">
            <Button onClick={handleBlocking}>
                {loading ? <Spinner /> : "Blocking"}
            </Button>
            <Button onClick={handleBackground}>
                {loading ? <Spinner /> : "Background"}
            </Button>
            <Button
                onClick={handleClientError}
                variant="destructive"
            >
                Client Error
            </Button>
            <Button
                onClick={handleServerError}
                variant="destructive"
            >
                Server Error
            </Button>
            <Button
                onClick={handleInngestError}
                variant="destructive"
            >
                Inngest Error
            </Button>
        </div>
    );
}