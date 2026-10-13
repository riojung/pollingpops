import type { Entitlements } from "@openround/contracts";
import type { PoolClient } from "pg";
import type { Segment, LiveRoomArtifactType } from "./types.js";

export type OrganizationRole = "owner" | "admin" | "billing" | "member";
export type OrganizationStatus = "active" | "suspended" | "closed";
export type PlatformRoomType = "round" | "presentation";
export interface OrganizationRecord {
  id: string;
  name: string;
  status: OrganizationStatus;
  createdAt: Date;
  updatedAt: Date;
}
export interface OrganizationMemberRecord {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: Date;
}
export interface OrganizationWorkspaceRecord {
  id: string;
  organizationId: string;
  name: string;
  segment: Segment;
  homeRegion: string;
  ownerId: string;
  status: "active" | "suspended";
}
export interface PlatformSubscription {
  organizationId: string;
  customerId: string | null;
  subscriptionId: string | null;
  status: string;
  licenseQuantity: number;
  offerId: string | null;
  paidThrough: Date | null;
  graceUntil: Date | null;
  updatedAt: Date;
  authoritative?: boolean;
  /** Historical paid tier until a versioned catalog offer replaces it. */
  legacyPlan?: "free" | "pro" | "team";
}
export interface LicenseAssignment {
  organizationId: string;
  workspaceId: string;
  assignedBy: string;
  assignedAt: Date;
}
export interface PlatformOffer {
  id: string;
  name: string;
  productKey: "pollingpops";
  kind: "workspace_subscription" | "credit_pack";
  status: "draft" | "published" | "archived";
  version: number;
  stripePriceId: string | null;
  currency: string | null;
  amountMinor: number | null;
  interval: "month" | "year" | null;
  creditQuantity: number;
  entitlements: Entitlements;
  createdAt: Date;
  updatedAt: Date;
}
export interface PlatformPurchase {
  id: string;
  organizationId: string;
  offer: PlatformOffer;
  quantity: number;
  checkoutId: string | null;
  paymentId: string | null;
  status: "pending" | "paid" | "refunded" | "canceled";
  createdAt: Date;
  updatedAt: Date;
}
export interface CreditBalance {
  organizationId: string;
  balance: number;
  reserved: number;
  available: number;
}
export interface CreditLedgerEntry {
  id: string;
  organizationId: string;
  delta: number;
  reason: string;
  sourceKey: string;
  actorId: string | null;
  roomId: string | null;
  artifactType: PlatformRoomType | null;
  createdAt: Date;
}
export interface PlatformRoomCoverageInput {
  artifactType: PlatformRoomType;
  roomId: string;
  workspaceId: string;
  funding: "auto" | "subscription" | "credit" | "free" | "legacy";
  snapshot: Entitlements;
  actorId: string | null;
  expiresAt: Date;
  creationKey?: string;
  creationRequestHash?: string;
}
export interface PlatformRoomCoverage extends Omit<PlatformRoomCoverageInput, "funding"> {
  organizationId: string;
  funding: "subscription" | "credit" | "free" | "legacy";
  reservationState: "none" | "reserved" | "consumed" | "released";
  createdAt: Date;
  consumedAt: Date | null;
  releasedAt: Date | null;
}
export interface PlatformPromotion {
  id: string;
  codeHash: string;
  name: string;
  kind: "credits" | "discount";
  creditQuantity: number;
  stripePromotionCodeId: string | null;
  organizationId: string | null;
  maximumRedemptions: number;
  expiresAt: Date | null;
  active: boolean;
  createdAt: Date;
}
export interface PlatformRedemption {
  id: string;
  organizationId: string;
  promotionId: string;
  actorId: string;
  stripePromotionCodeId: string | null;
  creditQuantity: number;
  createdAt: Date;
}
export interface PlatformBillingEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  providerCreatedAt: Date;
  state: "pending" | "processing" | "complete" | "failed";
  attempts: number;
  availableAt: Date;
  leaseToken: string | null;
  leaseUntil: Date | null;
  lastError: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
export type OperatorRole = "founder" | "operations" | "support" | "billing" | "readonly";
export interface PlatformOperator {
  id: string;
  issuer: string;
  subject: string;
  name: string;
  role: OperatorRole;
  capabilities: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export interface PlatformOperatorSession {
  id: string;
  operatorId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  authenticatedAt?: Date;
  lastSeenAt?: Date;
  csrfHash?: string;
}
export interface PlatformOperatorOidcTransaction {
  stateHash: string;
  browserBindingHash: string;
  codeVerifier: string;
  nonce: string;
  expiresAt: Date;
  consumedAt: Date | null;
  returnTo: string;
}
export interface PlatformAuditEvent {
  id: string;
  actorId: string;
  organizationId: string | null;
  action: string;
  targetId: string | null;
  reason: string;
  requestId: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
}
export interface PlatformCommandReceipt {
  id: string;
  actorId: string;
  idempotencyKey: string;
  requestHash: string;
  state: "running" | "complete" | "failed";
  result: unknown;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface PlatformIntegrationJob {
  id: string;
  integration: string;
  organizationId: string | null;
  eventType: string;
  deduplicationKey: string;
  payload: Record<string, unknown>;
  state: "pending" | "processing" | "complete" | "failed" | "ambiguous";
  attempts: number;
  availableAt: Date;
  leaseToken: string | null;
  leaseUntil: Date | null;
  lastError: string | null;
  externalId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  result?: Record<string, unknown> | null;
}
export interface PlatformCase {
  id: string;
  organizationId: string | null;
  category: string;
  title: string;
  state: "open" | "closed";
  details: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
export interface PlatformWorkerHeartbeat {
  id: string;
  status: "healthy" | "degraded";
  details: Record<string, unknown>;
  updatedAt: Date;
}
export interface PlatformWorkerControl {
  id: string;
  paused: boolean;
  updatedAt: Date;
}
export interface WorkspaceAdmissionRestriction {
  workspaceId: string;
  blocked: boolean;
  updatedAt: Date;
}
export interface OrganizationCommercialHold {
  organizationId: string;
  held: boolean;
  reason: string;
  updatedAt: Date;
}
export interface PlatformStripeTransaction {
  id: string;
  organizationId: string;
  kind: "sale" | "refund";
  amountMinor: number;
  currency: string;
  occurredAt: Date;
  paymentId: string | null;
  invoiceId: string | null;
  sourceEventId: string;
}
export interface PlatformCreditLedgerPage {
  entries: CreditLedgerEntry[];
  nextCursor: string | null;
}
export interface BusinessHealth {
  billing: { pending: number; processing: number; failed: number; oldestPendingAgeSeconds: number };
  integrations: Array<{
    integration: string;
    pending: number;
    processing: number;
    failed: number;
    ambiguous: number;
    oldestPendingAgeSeconds: number;
  }>;
  reservations: { active: number; expired: number };
  heartbeats: Array<{ id: string; status: "healthy" | "degraded"; ageSeconds: number }>;
}
export type ProductQueueKind = "round-report" | "presentation-report" | "authoring";
export interface ProductQueueHealth {
  kind: ProductQueueKind;
  pending: number;
  processing: number;
  failed: number;
  oldestPendingAgeSeconds: number;
  failedIds: string[];
  retryableFailedIds: string[];
}
export interface ActiveRoomSummary {
  organizationId: string;
  organizationName: string;
  workspaceId: string;
  workspaceName: string;
  artifactType: LiveRoomArtifactType;
  roomId: string;
  code: string;
  participantCount: number;
  expiresAt: Date;
  funding: PlatformRoomCoverage["funding"] | null;
}
export interface OrganizationInvitationRecord {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationRole;
  tokenHash: string;
  createdBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}
export interface PlatformIntegrationConnection {
  id: string;
  integration: string;
  status: "connected" | "disconnected";
  credentialCiphertext: string | null;
  configuration: Record<string, unknown>;
  updatedAt: Date;
}
export class PlatformError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

export interface PlatformRepository {
  withOperatorTransaction<T>(work: (repository: PlatformRepository) => Promise<T>): Promise<T>;
  withTransaction<T>(work: (repository: PlatformRepository) => Promise<T>): Promise<T>;
  listAllOrganizations(limit?: number): Promise<OrganizationRecord[]>;
  listOrganizationWorkspacesForOperator(
    organizationId: string,
  ): Promise<OrganizationWorkspaceRecord[]>;
  listCreditLedgerForOperator(organizationId: string, limit?: number): Promise<CreditLedgerEntry[]>;
  listCreditLedgerPageForOperator(
    organizationId: string,
    options: { from: Date; to: Date; cursor?: string; limit?: number },
  ): Promise<PlatformCreditLedgerPage>;
  recordStripeTransaction(input: PlatformStripeTransaction): Promise<PlatformStripeTransaction>;
  listStripeTransactionsForOperator(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<PlatformStripeTransaction[]>;
  getBusinessHealth(now?: Date): Promise<BusinessHealth>;
  listActiveRooms(organizationId?: string, limit?: number): Promise<ActiveRoomSummary[]>;
  getProductQueueHealth(now?: Date): Promise<ProductQueueHealth[]>;
  retryFailedProductJob(kind: ProductQueueKind, id: string, now?: Date): Promise<boolean>;
  retryBillingEvent(id: string, now?: Date): Promise<boolean>;
  updateWorkspaceStatus(
    workspaceId: string,
    status: "active" | "suspended",
  ): Promise<OrganizationWorkspaceRecord>;
  listOrganizations(
    userId: string,
  ): Promise<Array<OrganizationRecord & { role: OrganizationRole }>>;
  getOrganization(organizationId: string, userId: string): Promise<OrganizationRecord>;
  getOrganizationForWorkspace(workspaceId: string): Promise<OrganizationRecord | null>;
  createOrganization(input: {
    id?: string;
    name: string;
    actorId: string;
  }): Promise<OrganizationRecord>;
  updateOrganizationStatus(
    organizationId: string,
    status: OrganizationStatus,
  ): Promise<OrganizationRecord>;
  closeOrganization(organizationId: string, actorId: string): Promise<OrganizationRecord>;
  requireOrganizationRole(
    organizationId: string,
    userId: string,
    roles: OrganizationRole[],
  ): Promise<OrganizationMemberRecord>;
  listOrganizationMembers(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMemberRecord[]>;
  getVerifiedOrganizationContact(
    organizationId: string,
    userId: string,
  ): Promise<{ userId: string; email: string } | null>;
  listOrganizationContactsForOperator(
    organizationId: string,
  ): Promise<Array<{ userId: string; email: string }>>;
  setOrganizationMember(input: {
    organizationId: string;
    actorId: string;
    userId: string;
    role: OrganizationRole;
  }): Promise<OrganizationMemberRecord>;
  removeOrganizationMember(
    organizationId: string,
    actorId: string,
    userId: string,
  ): Promise<boolean>;
  createOrganizationInvitation(input: {
    organizationId: string;
    actorId: string;
    email: string;
    role: OrganizationRole;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<OrganizationInvitationRecord>;
  listOrganizationInvitations(
    organizationId: string,
    actorId: string,
  ): Promise<OrganizationInvitationRecord[]>;
  revokeOrganizationInvitation(
    organizationId: string,
    actorId: string,
    invitationId: string,
  ): Promise<boolean>;
  acceptOrganizationInvitation(input: {
    tokenHash: string;
    actorId: string;
    userEmail?: string;
    now?: Date;
  }): Promise<OrganizationMemberRecord>;
  listOrganizationWorkspaces(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationWorkspaceRecord[]>;
  createOrganizationWorkspace(input: {
    organizationId: string;
    actorId: string;
    name: string;
    segment: Segment;
    id?: string;
  }): Promise<OrganizationWorkspaceRecord>;
  transferWorkspaceOwnership(workspaceId: string, actorId: string, userId: string): Promise<void>;
  getSubscription(organizationId: string): Promise<PlatformSubscription>;
  listSubscriptions(): Promise<PlatformSubscription[]>;
  applySubscriptionSnapshot(
    input: Omit<PlatformSubscription, "updatedAt"> & { now?: Date },
  ): Promise<PlatformSubscription>;
  withOrganizationBillingLock<T>(
    organizationId: string,
    work: (repository: PlatformRepository) => Promise<T>,
  ): Promise<T>;
  withProviderBillingLock<T>(key: string, work: () => Promise<T>): Promise<T>;
  getOrganizationCommercialHold(organizationId: string): Promise<OrganizationCommercialHold | null>;
  setOrganizationCommercialHold(
    organizationId: string,
    held: boolean,
    reason: string,
  ): Promise<OrganizationCommercialHold>;
  listLicenseAssignments(organizationId: string, userId: string): Promise<LicenseAssignment[]>;
  assignWorkspaceLicense(
    organizationId: string,
    actorId: string,
    workspaceId: string,
    assigned: boolean,
  ): Promise<LicenseAssignment | null>;
  workspaceHasLicense(workspaceId: string, now?: Date): Promise<boolean>;
  effectiveWorkspacePlan(workspaceId: string, now?: Date): Promise<"free" | "pro" | "team" | null>;
  getWorkspaceAdmissionRestriction(
    workspaceId: string,
  ): Promise<WorkspaceAdmissionRestriction | null>;
  setWorkspaceAdmissionRestriction(
    workspaceId: string,
    blocked: boolean,
  ): Promise<WorkspaceAdmissionRestriction>;
  listOffers(includeDraft?: boolean): Promise<PlatformOffer[]>;
  getOffer(offerId: string): Promise<PlatformOffer | null>;
  saveOffer(offer: PlatformOffer): Promise<PlatformOffer>;
  createPurchase(input: {
    organizationId: string;
    actorId: string;
    offerId: string;
    quantity: number;
    idempotencyKey: string;
  }): Promise<PlatformPurchase>;
  updatePurchaseCheckout(purchaseId: string, checkoutId: string): Promise<PlatformPurchase>;
  getPurchase(purchaseId: string): Promise<PlatformPurchase | null>;
  findPurchaseByPaymentId(paymentId: string): Promise<PlatformPurchase | null>;
  listPendingPurchases(limit?: number): Promise<PlatformPurchase[]>;
  listPurchases(organizationId: string, userId: string): Promise<PlatformPurchase[]>;
  fulfillCreditPurchase(
    purchaseId: string,
    paymentId: string,
    now?: Date,
  ): Promise<PlatformPurchase>;
  markSubscriptionPurchasePaid(
    purchaseId: string,
    providerSubscriptionId: string,
    now?: Date,
  ): Promise<PlatformPurchase>;
  cancelPurchase(purchaseId: string): Promise<PlatformPurchase>;
  markPurchaseRefunded(purchaseId: string, paymentId?: string): Promise<PlatformPurchase>;
  getCreditBalance(organizationId: string): Promise<CreditBalance>;
  listCreditLedger(organizationId: string, userId: string): Promise<CreditLedgerEntry[]>;
  grantCredits(input: {
    organizationId: string;
    quantity: number;
    reason: string;
    sourceKey: string;
    actorId: string | null;
  }): Promise<CreditLedgerEntry>;
  adjustCredits(input: {
    organizationId: string;
    quantity: number;
    reason: string;
    sourceKey: string;
    actorId: string;
  }): Promise<CreditLedgerEntry>;
  reverseCreditConsumption(input: {
    artifactType: PlatformRoomType;
    roomId: string;
    actorId: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<CreditLedgerEntry>;
  getRoomCoverage(
    artifactType: PlatformRoomType,
    roomId: string,
  ): Promise<PlatformRoomCoverage | null>;
  getRoomCoverageByCreationKey(
    workspaceId: string,
    creationKey: string,
  ): Promise<PlatformRoomCoverage | null>;
  reserveRoomCoverage(input: PlatformRoomCoverageInput): Promise<PlatformRoomCoverage>;
  consumeRoomCoverage(
    artifactType: PlatformRoomType,
    roomId: string,
  ): Promise<PlatformRoomCoverage | null>;
  releaseRoomCoverage(
    artifactType: PlatformRoomType,
    roomId: string,
  ): Promise<PlatformRoomCoverage | null>;
  /** Repair-only: locks the durable parent and releases only empty terminal/expired rooms. */
  releaseExpiredRoomReservation(
    artifactType: PlatformRoomType,
    roomId: string,
  ): Promise<PlatformRoomCoverage | null>;
  listReservedRoomCoverages(now?: Date): Promise<PlatformRoomCoverage[]>;
  savePromotion(promotion: PlatformPromotion): Promise<PlatformPromotion>;
  listPromotions(): Promise<PlatformPromotion[]>;
  redeemPromotion(input: {
    organizationId: string;
    actorId: string;
    codeHash: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<PlatformRedemption>;
  enqueueBillingEvent(input: {
    providerEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    providerCreatedAt: Date;
  }): Promise<boolean>;
  claimBillingEvent(leaseMs?: number, now?: Date): Promise<PlatformBillingEvent | null>;
  completeBillingEvent(id: string, leaseToken: string, now?: Date): Promise<boolean>;
  failBillingEvent(id: string, leaseToken: string, error: string, now?: Date): Promise<boolean>;
  listBillingEvents(limit?: number): Promise<PlatformBillingEvent[]>;
  provisionOperator(
    input: Omit<PlatformOperator, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<PlatformOperator>;
  getOperatorByIdentity(issuer: string, subject: string): Promise<PlatformOperator | null>;
  getOperator(id: string): Promise<PlatformOperator | null>;
  listOperators(): Promise<PlatformOperator[]>;
  createOperatorSession(input: PlatformOperatorSession): Promise<void>;
  getOperatorSession(
    tokenHash: string,
    now?: Date,
  ): Promise<{ session: PlatformOperatorSession; operator: PlatformOperator } | null>;
  revokeOperatorSession(tokenHash: string): Promise<boolean>;
  revokeOperatorSessions(operatorId: string): Promise<number>;
  createOperatorOidcTransaction(input: PlatformOperatorOidcTransaction): Promise<void>;
  consumeOperatorOidcTransaction(
    stateHash: string,
    browserBindingHash: string,
    now?: Date,
  ): Promise<PlatformOperatorOidcTransaction | null>;
  touchOperatorSession(
    tokenHash: string,
    now: Date,
    idleCutoff: Date,
  ): Promise<{ session: PlatformOperatorSession; operator: PlatformOperator } | null>;
  appendAuditEvent(
    input: Omit<PlatformAuditEvent, "id" | "createdAt">,
  ): Promise<PlatformAuditEvent>;
  listAuditEvents(organizationId?: string, limit?: number): Promise<PlatformAuditEvent[]>;
  beginCommand(input: {
    actorId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ receipt: PlatformCommandReceipt; created: boolean }>;
  completeCommand(id: string, result: unknown): Promise<PlatformCommandReceipt>;
  failCommand(id: string, error: string): Promise<PlatformCommandReceipt>;
  enqueueIntegrationJob(input: {
    integration: string;
    organizationId: string | null;
    eventType: string;
    deduplicationKey: string;
    payload: Record<string, unknown>;
  }): Promise<PlatformIntegrationJob>;
  claimIntegrationJob(
    integration: string,
    leaseMs?: number,
    now?: Date,
  ): Promise<PlatformIntegrationJob | null>;
  completeIntegrationJob(
    id: string,
    leaseToken: string,
    externalId: string | null,
    now?: Date,
    result?: Record<string, unknown>,
  ): Promise<boolean>;
  failIntegrationJob(
    id: string,
    leaseToken: string,
    error: string,
    ambiguous?: boolean,
    now?: Date,
  ): Promise<boolean>;
  listIntegrationJobs(integration?: string, limit?: number): Promise<PlatformIntegrationJob[]>;
  getIntegrationJobByDeduplication(
    integration: string,
    deduplicationKey: string,
  ): Promise<PlatformIntegrationJob | null>;
  getIntegrationJob(id: string): Promise<PlatformIntegrationJob | null>;
  resolveAmbiguousIntegrationJob(
    id: string,
    externalId: string,
    result: Record<string, unknown>,
    now?: Date,
  ): Promise<boolean>;
  resolveAmbiguousSupportDelivery(
    id: string,
    externalId: string,
    result: Record<string, unknown>,
    now?: Date,
  ): Promise<boolean>;
  retryIntegrationJob(id: string): Promise<PlatformIntegrationJob>;
  saveIntegrationConnection(
    input: PlatformIntegrationConnection,
  ): Promise<PlatformIntegrationConnection>;
  getIntegrationConnection(id: string): Promise<PlatformIntegrationConnection | null>;
  createCase(input: {
    organizationId: string | null;
    category: string;
    title: string;
    details: Record<string, unknown>;
  }): Promise<PlatformCase>;
  listCases(state?: "open" | "closed"): Promise<PlatformCase[]>;
  closeCase(id: string): Promise<PlatformCase>;
  updateCaseProviderMirror(
    id: string,
    mirror: {
      issueKey: string;
      status: string;
      assignee: { accountId: string; displayName: string } | null;
      checkedAt: Date;
    },
  ): Promise<PlatformCase>;
  heartbeat(input: Omit<PlatformWorkerHeartbeat, "updatedAt">): Promise<PlatformWorkerHeartbeat>;
  listHeartbeats(): Promise<PlatformWorkerHeartbeat[]>;
  getWorkerControl(id: string): Promise<PlatformWorkerControl | null>;
  setWorkerControl(id: string, paused: boolean): Promise<PlatformWorkerControl>;
  assertIdentityDeletionAllowed(userId: string): Promise<void>;
  deleteIdentityMemberships(userId: string): Promise<void>;
}

export type PlatformTransactionClient = PoolClient;
