import { notFound } from "next/navigation";
import { PatchlightRound } from "./gallery";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ design?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PatchlightRound initialDesign={(await searchParams).design} />;
}
