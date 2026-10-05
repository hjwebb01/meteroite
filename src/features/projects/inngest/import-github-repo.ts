import ky from "ky";
import { isBinaryFile } from "isbinaryfile";
import { NonRetriableError } from "inngest";

import { getConvexAdminClient } from "@/lib/convex-client";
import { inngest } from "@/inngest/client";
import { createUserOctokit } from "@/lib/github";

import { internal } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

interface ImportGithubRepoEvent {
  owner: string;
  repo: string;
  projectId: Id<"projects">;
  userId: string;
}

export const importGithubRepo = inngest.createFunction(
  {
    id: "import-github-repo",
    triggers: { event: "github/import.repo" },
    onFailure: async ({ event, step }) => {
      const deployKey = process.env.CONVEX_DEPLOY_KEY;
      if (!deployKey) return;

      const { projectId } = event.data.event.data as ImportGithubRepoEvent;

      await step.run("set-failed-status", async () => {
        await getConvexAdminClient().mutation(
          internal.importExport.updateImportStatus,
          {
            projectId,
            status: "failed",
          },
        );
      });
    },
  },
  async ({ event, step }) => {
    const { owner, repo, projectId, userId } =
      event.data as ImportGithubRepoEvent;

    const deployKey = process.env.CONVEX_DEPLOY_KEY;
    if (!deployKey) {
      throw new NonRetriableError("CONVEX_DEPLOY_KEY is not configured");
    }

    // Cleanup any existing files in the project
    await step.run("cleanup-project", async () => {
      await getConvexAdminClient().mutation(internal.importExport.cleanup, {
        projectId,
      });
    });

    const tree = await step.run("fetch-repo-tree", async () => {
      const octokit = await createUserOctokit(userId);
      try {
        const { data } = await octokit.rest.git.getTree({
          owner,
          repo,
          tree_sha: "main",
          recursive: "1",
        });

        return data;
      } catch {
        // Fallback to master branch
        const { data } = await octokit.rest.git.getTree({
          owner,
          repo,
          tree_sha: "master",
          recursive: "1",
        });

        return data;
      }
    });

    // Sort folders by depth so parents are created before children
    // Input:  [{ path: "src/components" }, { path: "src" }, { path: "src/components/ui" }]
    // Output: [{ path: "src" }, { path: "src/components" }, { path: "src/components/ui" }]
    const folders = tree.tree
      .filter((item) => item.type === "tree" && item.path)
      .sort((a, b) => {
        const aDepth = a.path ? a.path.split("/").length : 0;
        const bDepth = b.path ? b.path.split("/").length : 0;

        return aDepth - bDepth;
      });

    // Return the folder map from the step so it can be used in subsequent steps
    // (Inngest serializes step results, so we use a plain object instead of Map)
    const folderIdMap = await step.run("create-folders", async () => {
      const map: Record<string, Id<"files">> = {};

      for (const folder of folders) {
        if (!folder.path) {
          continue;
        }

        const pathParts = folder.path.split("/");
        const name = pathParts.pop()!;
        const parentPath = pathParts.join("/");
        const parentId = parentPath ? map[parentPath] : undefined;

        const folderId = await getConvexAdminClient().mutation(
          internal.importExport.createFolder,
          {
            projectId,
            name,
            parentId,
          },
        );

        map[folder.path] = folderId;
      }

      return map;
    });

    // Get all files (blobs) from the tree
    const allFiles = tree.tree.filter(
      (item) => item.type === "blob" && item.path && item.sha,
    );

    await step.run("create-files", async () => {
      const octokit = await createUserOctokit(userId);
      for (const file of allFiles) {
        if (!file.path || !file.sha) {
          continue;
        }

        try {
          const { data: blob } = await octokit.rest.git.getBlob({
            owner,
            repo,
            file_sha: file.sha,
          });

          const buffer = Buffer.from(blob.content, "base64");
          const isBinary = await isBinaryFile(buffer);

          const pathParts = file.path.split("/");
          const name = pathParts.pop()!;
          const parentPath = pathParts.join("/");
          const parentId = parentPath ? folderIdMap[parentPath] : undefined;

          if (isBinary) {
            const uploadUrl = await getConvexAdminClient().mutation(
              internal.importExport.generateUploadUrl,
              {},
            );

            const { storageId } = await ky
              .post(uploadUrl, {
                headers: { "Content-Type": "application/octet-stream" },
                body: buffer,
              })
              .json<{ storageId: Id<"_storage"> }>();

            await getConvexAdminClient().mutation(
              internal.importExport.createBinaryFile,
              {
                projectId,
                name,
                storageId,
                parentId,
              },
            );
          } else {
            const content = buffer.toString("utf-8");

            await getConvexAdminClient().mutation(
              internal.importExport.createSingleFile,
              {
                projectId,
                parentId,
                name,
                content,
              },
            );
          }
        } catch {
          console.error(`Failed to import file: ${file.path}`);
        }
      }
    });

    await step.run("set-completed-status", async () => {
      await getConvexAdminClient().mutation(
        internal.importExport.updateImportStatus,
        {
          projectId,
          status: "completed",
        },
      );
    });

    return { success: true, projectId };
  },
);
