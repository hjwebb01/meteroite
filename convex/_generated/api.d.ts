/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as lib_coding_models from "../lib/coding_models.js";
import type * as lib_finding_lease from "../lib/finding_lease.js";
import type * as lib_owned_review from "../lib/owned_review.js";
import type * as lib_review_application from "../lib/review_application.js";
import type * as lib_review_application_fields from "../lib/review_application_fields.js";
import type * as lib_review_assessment from "../lib/review_assessment.js";
import type * as lib_review_fields from "../lib/review_fields.js";
import type * as lib_review_models from "../lib/review_models.js";
import type * as lib_review_navigation from "../lib/review_navigation.js";
import type * as lib_review_proposal_fields from "../lib/review_proposal_fields.js";
import type * as lib_review_reassessment from "../lib/review_reassessment.js";
import type * as lib_review_work_fields from "../lib/review_work_fields.js";
import type * as reviewApplications from "../reviewApplications.js";
import type * as reviewFindingJobs from "../reviewFindingJobs.js";
import type * as reviewInteractions from "../reviewInteractions.js";
import type * as reviewJobs from "../reviewJobs.js";
import type * as reviewProposals from "../reviewProposals.js";
import type * as reviews from "../reviews.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  "lib/coding_models": typeof lib_coding_models;
  "lib/finding_lease": typeof lib_finding_lease;
  "lib/owned_review": typeof lib_owned_review;
  "lib/review_application": typeof lib_review_application;
  "lib/review_application_fields": typeof lib_review_application_fields;
  "lib/review_assessment": typeof lib_review_assessment;
  "lib/review_fields": typeof lib_review_fields;
  "lib/review_models": typeof lib_review_models;
  "lib/review_navigation": typeof lib_review_navigation;
  "lib/review_proposal_fields": typeof lib_review_proposal_fields;
  "lib/review_reassessment": typeof lib_review_reassessment;
  "lib/review_work_fields": typeof lib_review_work_fields;
  reviewApplications: typeof reviewApplications;
  reviewFindingJobs: typeof reviewFindingJobs;
  reviewInteractions: typeof reviewInteractions;
  reviewJobs: typeof reviewJobs;
  reviewProposals: typeof reviewProposals;
  reviews: typeof reviews;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
