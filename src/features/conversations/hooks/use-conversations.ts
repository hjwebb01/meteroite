import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

export const useConversation = (id: Id<"conversations"> | null) => {
  return useQuery(api.conversations.getById, id ? { id } : "skip");
};
export const useMessages = (conversationId: Id<"conversations"> | null) => {
  return useQuery(
    api.conversations.getMessages,
    conversationId ? { conversationId } : "skip",
  );
};

export const useConversations = (projectId: Id<"projects">) => {
  return useQuery(api.conversations.getByProjectId, { projectId });
};
export const useCreateConversation = () => {
  return useMutation(api.conversations.create);
  // TODO: Add optimistic mutation
};

export const useSetConversationModel = () => {
  return useMutation(api.conversations.setModel).withOptimisticUpdate(
    (store, { id, model }) => {
      const conversation = store.getQuery(api.conversations.getById, { id });
      if (conversation) {
        store.setQuery(
          api.conversations.getById,
          { id },
          {
            ...conversation,
            model,
          },
        );
      }
    },
  );
};

export const useGetConversations = (projectId: Id<"projects">) => {
  return useQuery(api.conversations.getByProjectId, { projectId });
};
