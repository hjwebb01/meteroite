import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

const OPTIMISTIC_PROJECT_EPOCH = Date.now();
let optimisticProjectIdSeq = 0;
let optimisticProjectTimeSeq = 0;

const nextOptimisticProjectId = () =>
  `optimistic-project-${++optimisticProjectIdSeq}` as Id<"projects">;

const nextOptimisticTimestamp = () =>
  OPTIMISTIC_PROJECT_EPOCH + optimisticProjectTimeSeq++;

export const useProject = (projectId: Id<"projects">) => {
  return useQuery(api.projects.getById, {
    id: projectId,
  });
};

export const useProjects = () => {
  return useQuery(api.projects.get);
};

export const useProjectsPartial = (limit: number) => {
  return useQuery(api.projects.getPartial, {
    limit,
  });
};

export const useCreateProject = () => {
  return useMutation(api.projects.create).withOptimisticUpdate(
    (localStore, args) => {
      const existingProjects = localStore.getQuery(api.projects.get);
      if (existingProjects !== undefined) {
        const now = nextOptimisticTimestamp();
        const newProject = {
          _id: nextOptimisticProjectId(),
          _creationTime: now,
          name: args.name,
          ownerId: "anonymous",
          updatedAt: now,
        };
        localStore.setQuery(api.projects.get, {}, [
          newProject,
          ...existingProjects,
        ]);
      }
    },
  );
};

export const useRenameProject = () => {
  return useMutation(api.projects.rename).withOptimisticUpdate(
    (localStore, args) => {
      const existingProject = localStore.getQuery(api.projects.getById, {
        id: args.id,
      });
      if (existingProject !== undefined && existingProject !== null) {
        const updatedAt = nextOptimisticTimestamp();
        localStore.setQuery(
          api.projects.getById,
          { id: args.id },
          {
            ...existingProject,
            name: args.name,
            updatedAt,
          },
        );
      }
      const existingProjects = localStore.getQuery(api.projects.get);
      if (existingProjects !== undefined) {
        const updatedAt = nextOptimisticTimestamp();
        localStore.setQuery(
          api.projects.get,
          {},
          existingProjects.map((project) => {
            return project._id === args.id
              ? { ...project, name: args.name, updatedAt }
              : project;
          }),
        );
      }
    },
  );
};

export const useUpdateProjectSettings = () => {
  // TODO: add optimistic mutation
  return useMutation(api.projects.updateSettings);
};
