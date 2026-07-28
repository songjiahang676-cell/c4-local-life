import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  createOrganizationSchema,
  listOrganizationMembersQuerySchema,
  type CreateOrganizationRequest,
  type ListOrganizationMembersQuery,
  type OrganizationMemberCollection,
  type OrganizationResponse,
} from "@socal/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { activeUserPolicyActions } from "../../common/authorization/policy";
import { RequestContextAccessor } from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import {
  InvalidOrganizationMemberCursorError,
  OrganizationActorUnavailableError,
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
    throw error;
  }
}
