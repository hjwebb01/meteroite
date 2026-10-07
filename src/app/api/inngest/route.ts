import { applyReviewProposal } from "@/features/reviews/inngest/apply-review-proposal";
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { processMessage } from "@/features/conversations/inngest/process-message";
import { exportToGithub } from "@/features/projects/inngest/export-to-github";
import { importGithubRepo } from "@/features/projects/inngest/import-github-repo";
import { reviewPullRequest } from "@/features/reviews/inngest/review-pull-request";
import {
  reviewFindingWork,
  reviewFindingJanitor,
} from "@/features/reviews/inngest/review-finding-work";
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    exportToGithub,
    importGithubRepo,
    processMessage,
    reviewPullRequest,
    reviewFindingWork,
    reviewFindingJanitor,
    applyReviewProposal,
  ],
});
