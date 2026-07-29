import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "./common/api-environment.token";
import { AuthorizationModule } from "./common/authorization/authorization.module";
import { CsrfOriginGuard } from "./common/csrf-origin.guard";
import { AdminModule } from "./modules/admin/admin.module";
import type { ModerationStore } from "./modules/admin/moderation.store";
import type { MfaStore } from "./modules/admin/mfa.store";
import { AuthModule } from "./modules/auth/auth.module";
import type { AuthSessionStore } from "./modules/auth/auth-session.store";
import type { OtpChallengeStore } from "./modules/auth/otp-challenge.store";
import type { OtpDeliveryGateway } from "./modules/auth/otp-delivery.gateway";
import type { PasswordNotificationGateway } from "./modules/auth/password-notification.gateway";
import type { PasswordStore } from "./modules/auth/password.store";
import { HealthModule } from "./modules/health/health.module";
import { ListingsModule } from "./modules/listings/listings.module";
import type { ListingStore } from "./modules/listings/listing.store";
import type { MediaObjectStorage } from "./modules/media/media-object-storage";
import { MediaModule } from "./modules/media/media.module";
import type { MediaStore } from "./modules/media/media.store";
import type { OrganizationStore } from "./modules/organizations/organization.store";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import type { TaxonomyStore } from "./modules/taxonomy/taxonomy.store";

@Module({})
export class AppModule {
  static register(
    environment: ApiEnvironment,
    authSessionStore?: AuthSessionStore,
    otpChallengeStore?: OtpChallengeStore,
    otpDeliveryGateway?: OtpDeliveryGateway,
    organizationStore?: OrganizationStore,
    taxonomyStore?: TaxonomyStore,
    mediaStore?: MediaStore,
    mediaObjectStorage?: MediaObjectStorage,
    mfaStore?: MfaStore,
    passwordStore?: PasswordStore,
    passwordNotificationGateway?: PasswordNotificationGateway,
    listingStore?: ListingStore,
    moderationStore?: ModerationStore,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AuthorizationModule,
        AuthModule.register(
          environment,
          authSessionStore,
          otpChallengeStore,
          otpDeliveryGateway,
          passwordStore,
          passwordNotificationGateway,
        ),
        AdminModule.register(environment, mfaStore, moderationStore),
        HealthModule,
        ListingsModule.register(environment, listingStore, taxonomyStore),
        MediaModule.register(environment, mediaStore, mediaObjectStorage),
        OrganizationsModule.register(environment, organizationStore),
      ],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: APP_GUARD, useClass: CsrfOriginGuard },
      ],
    };
  }
}
