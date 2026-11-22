import { randomUUID } from "node:crypto";
import { SignJWT, createRemoteJWKSet, importJWK, jwtVerify, type JWK, type JWTPayload } from "jose";
import { z } from "zod";
import type { LtiRegistrationAvailability } from "@openround/contracts";
import type {
  CreatorContext,
  InstitutionPolicyRecord,
  LtiRegistrationRecord,
  Repository,
} from "@openround/db";
import type { AppConfig } from "./config.js";
import { hashToken, opaqueToken } from "./security.js";

const LTI_CLAIM = "https://purl.imsglobal.org/spec/lti/claim";
const LTI_DL_CLAIM = "https://purl.imsglobal.org/spec/lti-dl/claim";
const MESSAGE_TYPE = `${LTI_CLAIM}/message_type`;
const VERSION = `${LTI_CLAIM}/version`;
const DEPLOYMENT_ID = `${LTI_CLAIM}/deployment_id`;
const TARGET_LINK_URI = `${LTI_CLAIM}/target_link_uri`;
const ROLES = `${LTI_CLAIM}/roles`;
const CONTEXT = `${LTI_CLAIM}/context`;
const RESOURCE_LINK = `${LTI_CLAIM}/resource_link`;
const CUSTOM = "https://purl.imsglobal.org/spec/lti/claim/custom";
const DEEP_LINKING_SETTINGS = `${LTI_DL_CLAIM}/deep_linking_settings`;
const CONTENT_ITEMS = `${LTI_DL_CLAIM}/content_items`;
const DEEP_LINK_DATA = `${LTI_DL_CLAIM}/data`;

const DeepLinkingSettingsSchema = z.object({
  deep_link_return_url: z.string().url().max(2_048),
  accept_types: z.array(z.string()).min(1),
  accept_presentation_document_targets: z.array(z.string()),
  data: z.string().max(8_192).optional(),
});

const RolesSchema = z.array(z.string().min(1).max(1_000)).min(1);
const OptionalIdClaimSchema = z.object({ id: z.string().min(1).max(2_048) }).passthrough();

export type LtiErrorCode =
  | "LTI_DISABLED"
  | "LTI_REGISTRATION_NOT_FOUND"
  | "LTI_LAUNCH_INVALID"
  | "FEDERATED_IDENTITY_NOT_LINKED"
  | "INSTITUTION_NOT_ENABLED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT";

export class LtiError extends Error {
  constructor(
    public readonly code: LtiErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LtiError";
  }
}

export interface LtiJwtAdapter {
  verify(idToken: string, registration: LtiRegistrationRecord): Promise<JWTPayload>;
  sign(payload: JWTPayload): Promise<string>;
  publicJwks(): Promise<{ keys: JWK[] }>;
}

export class JoseLtiJwtAdapter implements LtiJwtAdapter {
  private readonly keyPromise: ReturnType<typeof importJWK>;
  private readonly publicJwk: JWK;
  private readonly remoteKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  constructor(
    private readonly privateJwk: JWK,
    private readonly keyId: string,
  ) {
    if (
      privateJwk.kty !== "RSA" ||
      privateJwk.alg !== "RS256" ||
      typeof privateJwk.d !== "string" ||
      typeof privateJwk.n !== "string" ||
      typeof privateJwk.e !== "string" ||
      Buffer.from(privateJwk.n, "base64url").byteLength < 256
    ) {
      throw new Error("LTI_TOOL_PRIVATE_JWK must be a private 2048-bit or stronger RS256 RSA key");
    }
    this.keyPromise = importJWK(privateJwk, "RS256");
    this.publicJwk = {
      kty: "RSA",
      n: privateJwk.n,
      e: privateJwk.e,
      kid: this.keyId,
      alg: "RS256",
      use: "sig",
    };
  }

  async verify(idToken: string, registration: LtiRegistrationRecord) {
    let keySet = this.remoteKeySets.get(registration.jwksUrl);
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL(registration.jwksUrl), {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60_000,
      });
      this.remoteKeySets.set(registration.jwksUrl, keySet);
    }
    const result = await jwtVerify(idToken, keySet, {
      issuer: registration.issuer,
      audience: registration.clientId,
      algorithms: ["RS256"],
      clockTolerance: 5,
      maxTokenAge: "5 minutes",
    });
    return result.payload;
  }

  async sign(payload: JWTPayload) {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: this.keyId, typ: "JWT" })
      .sign(await this.keyPromise);
  }

  async publicJwks() {
    return { keys: [this.publicJwk] };
  }
}

export function ltiJwtAdapterFromConfig(config: AppConfig): LtiJwtAdapter | null {
  if (config.LTI_MODE !== "tool") return null;
  let jwk: JWK;
  try {
    jwk = JSON.parse(config.LTI_TOOL_PRIVATE_JWK!) as JWK;
  } catch (cause) {
    throw new Error("LTI_TOOL_PRIVATE_JWK must contain valid JSON", { cause });
  }
  return new JoseLtiJwtAdapter(jwk, config.LTI_TOOL_KEY_ID);
}

function audienceIncludes(audience: JWTPayload["aud"], clientId: string) {
  return typeof audience === "string" ? audience === clientId : audience?.includes(clientId);
}

function launchRole(roles: string[]): "instructor" | "learner" {
  return roles.some((role) =>
    /(?:#|\/)(?:Instructor|Administrator|ContentDeveloper|TeachingAssistant)$/i.test(role),
  )
    ? "instructor"
    : "learner";
}

function stringClaim(payload: JWTPayload, name: string): string {
  const value = payload[name];
  if (typeof value === "string" && value.length > 0) return value;
  throw new LtiError("LTI_LAUNCH_INVALID", `LTI launch is missing ${name}`);
}

function workspacePolicyAllowsLti(policy: InstitutionPolicyRecord) {
  return policy.contractStatus !== "disabled" && policy.capabilities.lti;
}

export class LtiService {
  constructor(
    private readonly repository: Repository,
    private readonly config: AppConfig,
    private readonly jwt: LtiJwtAdapter | null,
  ) {}

  get enabled() {
    return this.config.LTI_MODE === "tool" && Boolean(this.jwt);
  }

  private requireEnabled() {
    if (!this.enabled || !this.jwt) throw new LtiError("LTI_DISABLED", "LTI is disabled");
    return this.jwt;
  }

  private async requireWorkspaceCapability(workspaceId: string) {
    const policy = await this.repository.getInstitutionPolicy(workspaceId);
    if (!workspacePolicyAllowsLti(policy)) {
      throw new LtiError("INSTITUTION_NOT_ENABLED", "LTI is not approved for this workspace");
    }
    return policy;
  }

  async listRegistrations(workspaceId: string) {
    const [policy, registrations] = await Promise.all([
      this.repository.getInstitutionPolicy(workspaceId),
      this.repository.listLtiRegistrations(workspaceId),
    ]);
    let availability: LtiRegistrationAvailability = "available";
    if (!workspacePolicyAllowsLti(policy)) {
      availability = "workspace_policy";
    } else if (!this.enabled) {
      availability = "deployment_disabled";
    } else if (!registrations.some((registration) => registration.status === "active")) {
      availability = "registration_required";
    }
    return { availability, registrations };
  }

  private validateRegistrationUrl(value: string, label: string) {
    const url = new URL(value);
    if (url.username || url.password) {
      throw new LtiError("LTI_LAUNCH_INVALID", `${label} must not contain credentials`);
    }
    if (url.hash) {
      throw new LtiError("LTI_LAUNCH_INVALID", `${label} must not contain a fragment`);
    }
    if (this.config.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new LtiError("LTI_LAUNCH_INVALID", `${label} must use HTTPS in production`);
    }
    return url;
  }

  async upsertRegistration(
    workspaceId: string,
    input: Omit<LtiRegistrationRecord, "id" | "workspaceId" | "createdAt" | "updatedAt">,
    id: string = randomUUID(),
  ) {
    this.requireEnabled();
    await this.requireWorkspaceCapability(workspaceId);
    this.validateRegistrationUrl(input.issuer, "Platform issuer");
    this.validateRegistrationUrl(input.authorizationEndpoint, "Authorization endpoint");
    this.validateRegistrationUrl(input.jwksUrl, "JWKS URL");
    if (input.tokenEndpoint) this.validateRegistrationUrl(input.tokenEndpoint, "Token endpoint");
    for (const origin of input.deepLinkReturnOrigins) {
      this.validateRegistrationUrl(origin, "Deep-link return origin");
    }
    const previous = await this.repository.getLtiRegistration(id);
    if (previous && previous.workspaceId !== workspaceId) {
      throw new LtiError("UNAUTHORIZED", "LTI registration belongs to another workspace");
    }
    const now = new Date();
    return this.repository.upsertLtiRegistration({
      id,
      workspaceId,
      ...input,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async login(input: {
    iss: string;
    login_hint: string;
    target_link_uri: string;
    lti_message_hint?: string;
    client_id?: string;
    lti_deployment_id?: string;
  }) {
    this.requireEnabled();
    const registration = await this.repository.findLtiRegistration(
      input.iss,
      input.client_id,
      input.lti_deployment_id,
    );
    if (!registration) {
      throw new LtiError(
        "LTI_REGISTRATION_NOT_FOUND",
        "No unique active LTI registration matches this platform launch",
      );
    }
    await this.requireWorkspaceCapability(registration.workspaceId);
    const target = new URL(input.target_link_uri);
    const launchEndpoint = new URL("/v1/lti/launch", this.config.PUBLIC_API_URL);
    if (target.origin !== launchEndpoint.origin || target.pathname !== launchEndpoint.pathname) {
      throw new LtiError(
        "LTI_LAUNCH_INVALID",
        "LTI target_link_uri is not a Polling Pops launch URL",
      );
    }

    const state = opaqueToken();
    const nonce = opaqueToken();
    const now = new Date();
    await this.repository.createLtiLoginTransaction({
      id: randomUUID(),
      workspaceId: registration.workspaceId,
      registrationId: registration.id,
      stateHash: hashToken(state),
      nonce,
      targetLinkUri: target.href,
      ltiMessageHint: input.lti_message_hint ?? null,
      expiresAt: new Date(now.getTime() + this.config.LTI_TRANSACTION_TTL_SECONDS * 1_000),
      createdAt: now,
    });
    const authorizationUrl = new URL(registration.authorizationEndpoint);
    authorizationUrl.searchParams.set("scope", "openid");
    authorizationUrl.searchParams.set("response_type", "id_token");
    authorizationUrl.searchParams.set("response_mode", "form_post");
    authorizationUrl.searchParams.set("prompt", "none");
    authorizationUrl.searchParams.set("client_id", registration.clientId);
    authorizationUrl.searchParams.set("redirect_uri", launchEndpoint.href);
    authorizationUrl.searchParams.set("login_hint", input.login_hint);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    if (input.lti_message_hint) {
      authorizationUrl.searchParams.set("lti_message_hint", input.lti_message_hint);
    }
    return { authorizationUrl: authorizationUrl.href };
  }

  async launch(state: string, idToken: string) {
    const jwt = this.requireEnabled();
    const now = new Date();
    const transaction = await this.repository.consumeLtiLoginTransaction(hashToken(state), now);
    if (!transaction) {
      throw new LtiError("LTI_LAUNCH_INVALID", "LTI state is invalid, expired, or already used");
    }
    const registration = await this.repository.getLtiRegistration(transaction.registrationId);
    if (!registration || registration.status !== "active") {
      throw new LtiError("LTI_REGISTRATION_NOT_FOUND", "LTI registration is no longer active");
    }
    const policy = await this.requireWorkspaceCapability(registration.workspaceId);
    let payload: JWTPayload;
    try {
      payload = await jwt.verify(idToken, registration);
    } catch (cause) {
      throw new LtiError("LTI_LAUNCH_INVALID", "LTI launch signature or claims are invalid", {
        cause,
      });
    }
    if (!audienceIncludes(payload.aud, registration.clientId)) {
      throw new LtiError("LTI_LAUNCH_INVALID", "LTI audience does not match this tool");
    }
    if (
      Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== registration.clientId
    ) {
      throw new LtiError("LTI_LAUNCH_INVALID", "LTI authorized party is invalid");
    }
    if (payload.nonce !== transaction.nonce) {
      throw new LtiError("LTI_LAUNCH_INVALID", "LTI nonce does not match the login request");
    }
    if (stringClaim(payload, DEPLOYMENT_ID) !== registration.deploymentId) {
      throw new LtiError("LTI_LAUNCH_INVALID", "LTI deployment is not registered");
    }
    if (stringClaim(payload, VERSION) !== "1.3.0") {
      throw new LtiError("LTI_LAUNCH_INVALID", "Only LTI 1.3.0 launches are supported");
    }
    const messageType = stringClaim(payload, MESSAGE_TYPE);
    if (messageType !== "LtiResourceLinkRequest" && messageType !== "LtiDeepLinkingRequest") {
      throw new LtiError("LTI_LAUNCH_INVALID", "Unsupported LTI message type");
    }
    const targetLinkUri = stringClaim(payload, TARGET_LINK_URI);
    if (targetLinkUri !== transaction.targetLinkUri) {
      throw new LtiError(
        "LTI_LAUNCH_INVALID",
        "Signed LTI target does not match the login request",
      );
    }
    const roles = RolesSchema.parse(payload[ROLES]);
    const role = launchRole(roles);
    if (messageType === "LtiDeepLinkingRequest" && role !== "instructor") {
      throw new LtiError("UNAUTHORIZED", "Only an instructor may create an LTI deep link");
    }
    const subject = stringClaim(payload, "sub");
    const contextClaim = payload[CONTEXT];
    const contextId = contextClaim ? OptionalIdClaimSchema.parse(contextClaim).id : null;
    const resourceLinkClaim = payload[RESOURCE_LINK];
    const resourceLinkId = resourceLinkClaim
      ? OptionalIdClaimSchema.parse(resourceLinkClaim).id
      : null;
    let quizId: string | null = null;
    let deepLinkReturnUrl: string | null = null;
    let deepLinkData: string | null = null;
    if (messageType === "LtiDeepLinkingRequest") {
      const settings = DeepLinkingSettingsSchema.parse(payload[DEEP_LINKING_SETTINGS]);
      if (!settings.accept_types.includes("ltiResourceLink")) {
        throw new LtiError("LTI_LAUNCH_INVALID", "Platform does not accept LTI resource links");
      }
      const returnUrl = new URL(settings.deep_link_return_url);
      if (!registration.deepLinkReturnOrigins.includes(returnUrl.origin)) {
        throw new LtiError("LTI_LAUNCH_INVALID", "Deep-link return origin is not registered");
      }
      deepLinkReturnUrl = returnUrl.href;
      deepLinkData = settings.data ?? null;
    } else {
      if (!resourceLinkId) {
        throw new LtiError("LTI_LAUNCH_INVALID", "Resource-link launch is missing its link id");
      }
      const custom = z.record(z.string(), z.string()).parse(payload[CUSTOM] ?? {});
      const candidateQuizId = custom.openround_quiz_id;
      if (candidateQuizId) {
        quizId = z.string().uuid().parse(candidateQuizId);
        const quiz = await this.repository.getQuiz(registration.workspaceId, quizId);
        if (!quiz || quiz.status !== "published") {
          throw new LtiError("NOT_FOUND", "The linked checkpoint set is not published");
        }
      }
      if (role === "learner" && policy.identityRequirement !== "institution") {
        throw new LtiError(
          "UNAUTHORIZED",
          "This workspace keeps learner participation anonymous; use the live-round join link",
        );
      }
      if (role === "learner") {
        throw new LtiError(
          "LTI_DISABLED",
          "Institution-identified learner launches require the separately gated roster workflow",
        );
      }
    }

    const identity = await this.repository.getExternalIdentity(
      registration.workspaceId,
      "lti",
      registration.issuer,
      subject,
    );
    const creator = identity
      ? await this.repository.getCreatorByUserId(identity.userId, registration.workspaceId)
      : null;
    if (identity && creator) await this.repository.touchExternalIdentity(identity.id, now);
    const linkToken = creator ? null : opaqueToken();
    const launch = await this.repository.createLtiLaunch({
      id: randomUUID(),
      workspaceId: registration.workspaceId,
      registrationId: registration.id,
      creatorUserId: creator?.userId ?? null,
      subject,
      messageType,
      role,
      targetLinkUri,
      quizId,
      contextId,
      resourceLinkId,
      deepLinkReturnUrl,
      deepLinkData,
      linkTokenHash: linkToken ? hashToken(linkToken) : null,
      responseJwt: null,
      completedAt: null,
      expiresAt: new Date(now.getTime() + this.config.LTI_LAUNCH_TTL_SECONDS * 1_000),
      createdAt: now,
    });
    return { launch, creator, linkToken };
  }

  async bind(creator: CreatorContext, linkToken: string) {
    const launch = await this.repository.bindLtiLaunch(
      hashToken(linkToken),
      creator.userId,
      randomUUID(),
      new Date(),
    );
    if (!launch || launch.workspaceId !== creator.workspaceId || !launch.subject) {
      throw new LtiError(
        "UNAUTHORIZED",
        "This LTI launch is invalid, expired, or belongs to another workspace",
      );
    }
    return launch;
  }

  async getLaunch(creator: CreatorContext, launchId: string) {
    const launch = await this.repository.getLtiLaunch(creator.workspaceId, launchId, new Date());
    if (!launch || launch.creatorUserId !== creator.userId) {
      throw new LtiError("NOT_FOUND", "LTI launch not found");
    }
    return launch;
  }

  async createDeepLink(creator: CreatorContext, launchId: string, quizId: string) {
    const jwt = this.requireEnabled();
    const launch = await this.getLaunch(creator, launchId);
    if (launch.messageType !== "LtiDeepLinkingRequest" || !launch.deepLinkReturnUrl) {
      throw new LtiError("CONFLICT", "This launch is not a deep-link request");
    }
    if (launch.responseJwt) {
      return {
        returnUrl: launch.deepLinkReturnUrl,
        jwt: launch.responseJwt,
        quizId: launch.quizId,
      };
    }
    const quiz = await this.repository.getQuiz(creator.workspaceId, quizId);
    if (!quiz || quiz.status !== "published") {
      throw new LtiError("NOT_FOUND", "Select a published checkpoint set");
    }
    const registration = await this.repository.getLtiRegistration(launch.registrationId);
    if (!registration || registration.status !== "active") {
      throw new LtiError("LTI_REGISTRATION_NOT_FOUND", "LTI registration is no longer active");
    }
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const payload: JWTPayload = {
      iss: registration.clientId,
      sub: registration.clientId,
      aud: registration.issuer,
      iat: nowSeconds,
      exp: nowSeconds + 300,
      nonce: opaqueToken(),
      jti: randomUUID(),
      [DEPLOYMENT_ID]: registration.deploymentId,
      [MESSAGE_TYPE]: "LtiDeepLinkingResponse",
      [VERSION]: "1.3.0",
      [CONTENT_ITEMS]: [
        {
          type: "ltiResourceLink",
          title: quiz.title,
          text: quiz.description || "Polling Pops comprehension checkpoint set",
          url: new URL("/v1/lti/launch", this.config.PUBLIC_API_URL).href,
          custom: { openround_quiz_id: quiz.id },
        },
      ],
      ...(launch.deepLinkData ? { [DEEP_LINK_DATA]: launch.deepLinkData } : {}),
    };
    const responseJwt = await jwt.sign(payload);
    const completed = await this.repository.completeLtiDeepLink(
      creator.workspaceId,
      launch.id,
      creator.userId,
      quiz.id,
      responseJwt,
      new Date(),
    );
    if (!completed?.responseJwt) throw new LtiError("CONFLICT", "Deep-link launch expired");
    return {
      returnUrl: launch.deepLinkReturnUrl,
      jwt: completed.responseJwt,
      quizId: completed.quizId,
    };
  }

  async publicJwks() {
    return this.requireEnabled().publicJwks();
  }
}
