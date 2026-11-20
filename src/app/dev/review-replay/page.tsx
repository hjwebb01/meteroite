import { notFound } from "next/navigation";
import { ReviewReplay } from "@/features/reviews/components/review-replay";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ speed?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  return <ReviewReplay speed={Number((await searchParams).speed) || 1} />;
}
