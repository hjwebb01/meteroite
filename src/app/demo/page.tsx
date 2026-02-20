"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useState } from "react";

export default function DemoPage() {
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
    }
    return (
        <div className="p-8 space-x-4">
            <Button onClick={handleBlocking}>
                {loading ? <Spinner /> : "Blocking"}
            </Button>
            <Button onClick={handleBackground}>
                {loading ? <Spinner /> : "Background"}
            </Button>
        </div>
    );
}