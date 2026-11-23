export type UserRole = "client" | "marketer";

export interface User {
  role: UserRole;
  login: string;
  displayName: string;
  userId?: string;
}

export interface OfferRequest {
  userId: string;
  ruleName: string;
  eventTs: string;
  triggerTs: string;
  metadata: {
    source: string;
    userId: string;
    clientVersion: string;
  };
}

export interface OfferDetails {
  offerId: string;
  noticeId?: string;
}

export interface Offer {
  notice: string;
  details: OfferDetails;
}

export interface OfferResponse {
  traceId?: string;
  userId?: string;
  timestamp?: string;
  offers: Offer[];
}

export interface CreateOfferRequest {
  ruleName: string;
  notice: string;
}

export interface CreateOfferResponse {
  status: "created";
}
