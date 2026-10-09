import { applyReviewProposal } from "@/features/reviews/inngest/apply-review-proposal";
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { reviewPullRequest } from "@/features/reviews/inngest/review-pull-request";
import {
  reviewFindingWork,
  reviewFindingJanitor,
} from "@/features/reviews/inngest/review-finding-work";
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    reviewPullRequest,
    reviewFindingWork,
    reviewFindingJanitor,
    applyReviewProposal,
  ],
});
