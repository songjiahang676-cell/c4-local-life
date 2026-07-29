import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  listNotificationsQuerySchema,
  type ListNotificationsQuery,
  type NotificationCollection,
  type NotificationResponse,
} from "@socal/contracts";
import type { FastifyRequest } from "fastify";
import { selfServicePolicyActions } from "../../common/authorization/policy";
import { RequestContextAccessor } from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import {
  NotificationCursorError,
  NotificationNotFoundError,
  NotificationsService,
} from "./notifications.service";

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @Header("Vary", "Cookie")
  @RequirePolicy(selfServicePolicyActions.notificationsRead)
  async list(
    @Req() request: FastifyRequest,
    @Query(new SchemaValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ): Promise<NotificationCollection> {
    try {
      return await this.notifications.list(this.contexts.require(request), query);
    } catch (error) {
      if (error instanceof NotificationCursorError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Put(":notificationId/read")
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @Header("Vary", "Cookie")
  @RequirePolicy(selfServicePolicyActions.notificationsUpdate)
  async markRead(
    @Req() request: FastifyRequest,
    @Param("notificationId", new ParseUUIDPipe({ version: "4" })) notificationId: string,
  ): Promise<NotificationResponse> {
    try {
      return await this.notifications.markRead(this.contexts.require(request), notificationId);
    } catch (error) {
      if (error instanceof NotificationNotFoundError) {
        throw new NotFoundException("Notification not found");
      }
      throw error;
    }
  }
}
