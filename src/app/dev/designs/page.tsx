import { notFound } from "next/navigation";
import { ExplorationGallery } from "./exploration-gallery";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ design?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  return <ExplorationGallery initialDesign={(await searchParams).design} />;
}
