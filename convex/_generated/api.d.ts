/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentFiles from "../agentFiles.js";
import type * as agentLimits from "../agentLimits.js";
import type * as auth from "../auth.js";
import type * as constants from "../constants.js";
import type * as conversations from "../conversations.js";
import type * as files from "../files.js";
import type * as importExport from "../importExport.js";
import type * as lib_coding_models from "../lib/coding_models.js";
import type * as lib_project_files from "../lib/project_files.js";
import type * as lib_project_paths from "../lib/project_paths.js";
import type * as projects from "../projects.js";
import type * as systemMessages from "../systemMessages.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentFiles: typeof agentFiles;
  agentLimits: typeof agentLimits;
  auth: typeof auth;
  constants: typeof constants;
  conversations: typeof conversations;
  files: typeof files;
  importExport: typeof importExport;
  "lib/coding_models": typeof lib_coding_models;
  "lib/project_files": typeof lib_project_files;
  "lib/project_paths": typeof lib_project_paths;
  projects: typeof projects;
  systemMessages: typeof systemMessages;
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
