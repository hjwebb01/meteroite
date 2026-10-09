export interface ChatGPTModel {
  id: string;
  name: string;
  provider: "openai";
}

export interface ChatGPTStatus {
  available: boolean;
  connected: boolean;
  enabled: boolean;
  email?: string;
  model?: string;
  connectionId?: string;
  models: ChatGPTModel[];
  error?: string;
}

export const UNAVAILABLE_CHATGPT_STATUS: ChatGPTStatus = {
  available: false,
  connected: false,
  enabled: false,
  models: [],
};

/** Only identifiers travel through Inngest; credentials stay on this machine. */
export interface ChatGPTSelection {
  userId: string;
  connectionId: string;
  model: string;
}
