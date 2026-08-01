import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { ApiEnvironment } from "@socal/config";
import { MetricsRegistry } from "@socal/observability";
import { API_ENVIRONMENT } from "./common/api-environment.token";
import { AuthorizationModule } from "./common/authorization/authorization.module";
import { CsrfOriginGuard } from "./common/csrf-origin.guard";
import { AdminModule } from "./modules/admin/admin.module";
import type { ModerationStore } from "./modules/admin/moderation.store";
import type { MfaStore } from "./modules/admin/mfa.store";
import type { QueueOperationsStore } from "./modules/admin/queue-operations.store";
import { AuthModule } from "./modules/auth/auth.module";
import type { AuthSessionStore } from "./modules/auth/auth-session.store";
import type { OtpChallengeStore } from "./modules/auth/otp-challenge.store";
import type { OtpDeliveryGateway } from "./modules/auth/otp-delivery.gateway";
import type { PasswordNotificationGateway } from "./modules/auth/password-notification.gateway";
import type { PasswordStore } from "./modules/auth/password.store";
import { HealthModule } from "./modules/health/health.module";
import type { HomepageDataSource } from "./modules/homepage/homepage-data.source";
import type { HomepageCache } from "./modules/homepage/homepage-cache";
import { HomepageModule } from "./modules/homepage/homepage.module";
import type { HomepageLayoutStore } from "./modules/homepage-layout/homepage-layout.store";
import { ListingsModule } from "./modules/listings/listings.module";
import type { ListingStore } from "./modules/listings/listing.store";
import type { MediaObjectStorage } from "./modules/media/media-object-storage";
import { MediaModule } from "./modules/media/media.module";
import type { MediaStore } from "./modules/media/media.store";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import type { NotificationStore } from "./modules/notifications/notification.store";
import type { OrganizationStore } from "./modules/organizations/organization.store";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { PerformanceModule } from "./modules/performance/performance.module";
import { SearchModule } from "./modules/search/search.module";
import type { SearchDiscoveryStore } from "./modules/search/search-discovery.store";
import type { SearchStore } from "./modules/search/search.store";
import type { TaxonomyStore } from "./modules/taxonomy/taxonomy.store";
import { TrustSafetyModule } from "./modules/trust-safety/trust-safety.module";
import type { TrustSafetyStore } from "./modules/trust-safety/trust-safety.store";

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
    notificationStore?: NotificationStore,
    trustSafetyStore?: TrustSafetyStore,
    searchStore?: SearchStore,
    searchDiscoveryStore?: SearchDiscoveryStore,
    metrics?: MetricsRegistry,
    homepageLayoutStore?: HomepageLayoutStore,
    homepageDataSource?: HomepageDataSource,
    homepageCache?: HomepageCache,
    queueOperationsStore?: QueueOperationsStore,
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
        AdminModule.register(environment, mfaStore, moderationStore, metrics, queueOperationsStore),
        HealthModule,
        HomepageModule.register(
          environment,
          homepageLayoutStore,
          homepageDataSource,
          metrics,
          homepageCache,
        ),
        ListingsModule.register(environment, listingStore, taxonomyStore),
        MediaModule.register(environment, mediaStore, mediaObjectStorage),
        NotificationsModule.register(environment, notificationStore),
        OrganizationsModule.register(environment, organizationStore),
        PerformanceModule.register(metrics ?? new MetricsRegistry()),
        SearchModule.register(environment, searchStore, metrics, searchDiscoveryStore),
        TrustSafetyModule.register(environment, trustSafetyStore),
      ],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: APP_GUARD, useClass: CsrfOriginGuard },
      ],
    };
  }
}
