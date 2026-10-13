import { notFound } from "next/navigation";
import { LandingStressTest } from "@/features/reviews/components/landing-stress-test";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  return <LandingStressTest initialData={(await searchParams).data} />;
}
