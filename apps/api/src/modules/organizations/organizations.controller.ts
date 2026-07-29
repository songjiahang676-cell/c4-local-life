import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  GoneException,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  changeOrganizationMemberRoleSchema,
  createOrganizationInvitationSchema,
  createOrganizationSchema,
  idempotencyKeySchema,
  listOrganizationMembersQuerySchema,
  transferOrganizationOwnershipSchema,
  type ChangeOrganizationMemberRoleRequest,
  type CreateOrganizationInvitationRequest,
  type CreateOrganizationRequest,
  type ListOrganizationMembersQuery,
  type OrganizationInvitationResponse,
  type OrganizationMemberCollection,
  type OrganizationMemberResponse,
  type OrganizationOwnerTransferResponse,
  type OrganizationResponse,
  type TransferOrganizationOwnershipRequest,
} from "@socal/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { activeUserPolicyActions } from "../../common/authorization/policy";
import { RequestContextAccessor } from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import {
  InvalidOrganizationMemberCursorError,
  OrganizationActorUnavailableError,
  OrganizationInvitationConflictError,
  OrganizationInvitationExpiredError,
  organizationMemberEtag,
  OrganizationMemberConflictError,
  organizationMemberVersionFromEtag,
  OrganizationNotFoundError,
  OrganizationSlugConflictError,
  OrganizationsService,
} from "./organizations.service";

@Controller("organizations")
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Post()
  @HttpCode(201)
  @RequirePolicy(activeUserPolicyActions.organizationCreate)
  @Header("Cache-Control", "no-store")
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new SchemaValidationPipe(createOrganizationSchema)) input: CreateOrganizationRequest,
  ): Promise<OrganizationResponse> {
    try {
      const organization = await this.organizations.create(this.contexts.require(request), input);
      void reply.header("Location", `/v1/organizations/${organization.id}`);
      return { data: organization };
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Get(":organizationId")
  @Header("Cache-Control", "no-store")
  async get(
    @Req() request: FastifyRequest,
    @Param("organizationId", new ParseUUIDPipe({ version: "4" })) organizationId: string,
  ): Promise<OrganizationResponse> {
    try {
      return {
        data: await this.organizations.get(this.contexts.require(request), organizationId),
      };
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Get(":organizationId/members")
  @Header("Cache-Control", "no-store")
  async listMembers(
    @Req() request: FastifyRequest,
    @Param("organizationId", new ParseUUIDPipe({ version: "4" })) organizationId: string,
    @Query(new SchemaValidationPipe(listOrganizationMembersQuerySchema))
    query: ListOrganizationMembersQuery,
  ): Promise<OrganizationMemberCollection> {
    try {
      return await this.organizations.listMembers(
        this.contexts.require(request),
        organizationId,
        query,
      );
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Post(":organizationId/invitations")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  async createInvitation(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("organizationId", new ParseUUIDPipe({ version: "4" })) organizationId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(createOrganizationInvitationSchema))
    input: CreateOrganizationInvitationRequest,
  ): Promise<OrganizationInvitationResponse> {
    const idempotencyKey = new SchemaValidationPipe(idempotencyKeySchema).transform(
      rawIdempotencyKey,
    );
    try {
      const response = await this.organizations.createInvitation(
        this.contexts.require(request),
        organizationId,
        idempotencyKey,
        input,
      );
      void reply.header(
        "Location",
        `/v1/organizations/${organizationId}/invitations/${response.data.id}`,
      );
      return response;
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Delete(":organizationId/invitations/:invitationId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async revokeInvitation(
    @Req() request: FastifyRequest,
    @Param("organizationId", new ParseUUIDPipe({ version: "4" })) organizationId: string,
    @Param("invitationId", new ParseUUIDPipe({ version: "4" })) invitationId: string,
  ): Promise<void> {
    try {
      await this.organizations.revokeInvitation(
        this.contexts.require(request),
        organizationId,
        invitationId,
      );
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Patch(":organizationId/members/:memberUserId")
  @Header("Cache-Control", "no-store")
  async changeMemberRole(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("organizationId", new ParseUUIDPipe({ version: "4" })) organizationId: string,
    @Param("memberUserId", new ParseUUIDPipe({ version: "4" })) memberUserId: string,
    @Headers("if-match") rawIfMatch: string | undefined,
    @Body(new SchemaValidationPipe(changeOrganizationMemberRoleSchema))
    input: ChangeOrganizationMemberRoleRequest,
  ): Promise<OrganizationMemberResponse> {
    const expectedVersion = organizationMemberVersionFromEtag(rawIfMatch);
    if (!expectedVersion) {
      throw new BadRequestException("A valid If-Match organization member ETag is required");
    }
    try {
      const response = await this.organizations.changeMemberRole(
        this.contexts.require(request),
        organizationId,
        memberUserId,
        expectedVersion,
        input,
      );
      void reply.header("ETag", organizationMemberEtag(response.data.version));
      return response;
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Delete(":organizationId/members/:memberUserId")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async removeMember(
    @Req() request: FastifyRequest,
    @Param("organizationId", new ParseUUIDPipe({ version: "4" })) organizationId: string,
    @Param("memberUserId", new ParseUUIDPipe({ version: "4" })) memberUserId: string,
    @Headers("if-match") rawIfMatch: string | undefined,
  ): Promise<void> {
    const expectedVersion = organizationMemberVersionFromEtag(rawIfMatch);
    if (!expectedVersion) {
      throw new BadRequestException("A valid If-Match organization member ETag is required");
    }
    try {
      await this.organizations.removeMember(
        this.contexts.require(request),
        organizationId,
        memberUserId,
        expectedVersion,
      );
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Post(":organizationId/owner-transfer")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async transferOwnership(
    @Req() request: FastifyRequest,
    @Param("organizationId", new ParseUUIDPipe({ version: "4" })) organizationId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(transferOrganizationOwnershipSchema))
    input: TransferOrganizationOwnershipRequest,
  ): Promise<OrganizationOwnerTransferResponse> {
    const idempotencyKey = new SchemaValidationPipe(idempotencyKeySchema).transform(
      rawIdempotencyKey,
    );
    try {
      return await this.organizations.transferOwnership(
        this.contexts.require(request),
        organizationId,
        idempotencyKey,
        input,
      );
    } catch (error) {
      this.#rethrow(error);
    }
  }

  #rethrow(error: unknown): never {
    if (error instanceof OrganizationSlugConflictError) {
      throw new ConflictException("Organization slug is unavailable");
    }
    if (error instanceof OrganizationActorUnavailableError) {
      throw new ForbiddenException("Access denied");
    }
    if (error instanceof OrganizationNotFoundError) {
      throw new NotFoundException("Organization not found");
    }
    if (error instanceof InvalidOrganizationMemberCursorError) {
      throw new BadRequestException("Member cursor is invalid");
    }
    if (error instanceof OrganizationInvitationExpiredError) {
      throw new GoneException("Organization invitation has expired");
    }
    if (
      error instanceof OrganizationInvitationConflictError ||
      error instanceof OrganizationMemberConflictError
    ) {
      throw new ConflictException(error.message);
    }
    throw error;
  }
}

@Controller("organization-invitations")
export class OrganizationInvitationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Put(":invitationId/accept")
  @RequirePolicy(activeUserPolicyActions.organizationInvitationAccept)
  @Header("Cache-Control", "no-store")
  async acceptInvitation(
    @Req() request: FastifyRequest,
    @Param("invitationId", new ParseUUIDPipe({ version: "4" })) invitationId: string,
  ): Promise<OrganizationInvitationResponse> {
    try {
      return await this.organizations.acceptInvitation(
        this.contexts.require(request),
        invitationId,
      );
    } catch (error) {
      if (error instanceof OrganizationInvitationExpiredError) {
        throw new GoneException("Organization invitation has expired");
      }
      if (error instanceof OrganizationInvitationConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof OrganizationNotFoundError) {
        throw new NotFoundException("Organization invitation not found");
      }
      throw error;
    }
  }
}
