import type { WebContainer } from "@webcontainer/api";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { projectPaths } from "../../../../convex/lib/project-paths";

type Entry = { path: string; type: "file" | "folder"; content?: string };

function snapshot(files: Doc<"files">[]) {
  const { pathById } = projectPaths(files);
  const entries = new Map<string, Entry>();
  for (const file of files) {
    if (file.type === "file" && (file.storageId || file.content === undefined))
      continue;
    entries.set(file._id, {
      path: pathById.get(file._id)!,
      type: file.type,
      content: file.type === "file" ? file.content : undefined,
    });
  }
  return entries;
}

/** Track the mounted project and apply subsequent snapshots in order. */
export function createFileSync(
  fs: Pick<WebContainer["fs"], "writeFile" | "rm"> & {
    mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  },
  initialFiles: Doc<"files">[],
) {
  let previous = snapshot(initialFiles);
  let pending = Promise.resolve();

  return (files: Doc<"files">[]) => {
    const next = snapshot(files);
    const update = pending.then(async () => {
      // Remove all obsolete paths first, including before path swaps or reuse.
      const removed = [...previous]
        .filter(([id, entry]) => {
          const replacement = next.get(id);
          return (
            !replacement ||
            replacement.path !== entry.path ||
            replacement.type !== entry.type
          );
        })
        .map(([, entry]) => entry)
        .sort((a, b) => b.path.split("/").length - a.path.split("/").length);
      for (const entry of removed) {
        await fs.rm(entry.path, {
          force: true,
          recursive: entry.type === "folder",
        });
      }

      for (const [id, entry] of next) {
        const old = previous.get(id);
        if (
          old?.path === entry.path &&
          old.type === entry.type &&
          old.content === entry.content &&
          !removed.some(
            (removedEntry) =>
              entry.path === removedEntry.path ||
              (removedEntry.type === "folder" &&
                entry.path.startsWith(`${removedEntry.path}/`)),
          )
        )
          continue;
        if (entry.type === "folder") {
          await fs.mkdir(entry.path, { recursive: true });
        } else {
          const slash = entry.path.lastIndexOf("/");
          if (slash !== -1)
            await fs.mkdir(entry.path.slice(0, slash), { recursive: true });
          await fs.writeFile(entry.path, entry.content!);
        }
      }
      previous = next;
    });
    // A failed update is reported to its caller, but must not poison the queue.
    pending = update.catch(() => {});
    return update;
  };
}
