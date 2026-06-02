export type AgentLoginData = {
  cumulative_consume: string;
  cumulative_consume_stars: string;
  cumulative_deposit: string;
  cumulative_deposit_stars: string;
  cumulative_reward: string;
  diamonds: string;
  guarantor: string;
  id: string;
  phone: string;
  region: string;
  session: string;
  stars: string;
  status: string;
  username: string;
};

export type AgentLoginResponse = {
  data: AgentLoginData;
  result: number;
  success: boolean;
};

export type TargetUserInfo = {
  targetUid: string;
  avatar: string;
  bio: string;
  nickname: string;
};

export type TargetUserInfoResponse = {
  data: {
    avatar: string;
    bio: string;
    nickname: string;
  };
  message?: string;
  result: number;
  success: boolean;
};

export type TransferAssetType = "diamonds" | "stars";

export type TransferAccountInput = {
  targetUid: string;
  transferNum: number;
  transferType: TransferAssetType;
};

export type TransferAccountResponse = {
  data?: unknown;
  message?: string;
  result: number;
  success: boolean;
};

export class LitmatchAgentError extends Error {
  constructor(
    message: string,
    readonly code: "AUTH" | "NOT_FOUND" | "API" | "CONFIG" = "API",
  ) {
    super(message);
    this.name = "LitmatchAgentError";
  }
}
