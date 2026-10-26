import { InMemoryAttendanceRepository, SupabaseAttendanceRepository, type AttendanceRepository } from "./attendance";
import type { Db } from "./db";
import { InMemoryDataset } from "./in-memory";
import { InMemoryMemberRepository, SupabaseMemberRepository, type MemberRepository } from "./members";
import { InMemoryBadgeRepository, SupabaseBadgeRepository, type BadgeRepository } from "./badges";
import { InMemoryPushSubscriptionRepository, SupabasePushSubscriptionRepository, type PushSubscriptionRepository } from "./push-subscriptions";
import { InMemoryReminderLogRepository, SupabaseReminderLogRepository, type ReminderLogRepository } from "./reminder-log";
import { InMemoryNotificationRepository, SupabaseNotificationRepository, type NotificationRepository } from "./notifications";
import { InMemoryPrickleRepository, SupabasePrickleRepository, type PrickleRepository } from "./prickles";

/**
 * Every repository, one per aggregate. Pages, actions and routes depend on these interfaces, not on
 * Supabase, so tests pass in-memory twins (`createInMemoryRepos`) and only the repositories' own
 * tests need a database. New aggregates are added here.
 */
export interface Repos {
  attendance: AttendanceRepository;
  prickles: PrickleRepository;
  members: MemberRepository;
  notifications: NotificationRepository;
  badges: BadgeRepository;
  pushSubscriptions: PushSubscriptionRepository;
  reminderLog: ReminderLogRepository;
}

/** Repositories over one client. Which privilege they run with is the client's: user-scoped (RLS) or service role. */
export function createRepos(db: Db): Repos {
  return {
    attendance: new SupabaseAttendanceRepository(db),
    prickles: new SupabasePrickleRepository(db),
    members: new SupabaseMemberRepository(db),
    notifications: new SupabaseNotificationRepository(db),
    badges: new SupabaseBadgeRepository(db),
    pushSubscriptions: new SupabasePushSubscriptionRepository(db),
    reminderLog: new SupabaseReminderLogRepository(db),
  };
}

/** In-memory repositories over one dataset, so joins between them work. For tests, demos and seed profiles. */
export function createInMemoryRepos(dataset: InMemoryDataset = new InMemoryDataset()): Repos {
  return {
    attendance: new InMemoryAttendanceRepository(dataset),
    prickles: new InMemoryPrickleRepository(dataset),
    members: new InMemoryMemberRepository(dataset),
    notifications: new InMemoryNotificationRepository(dataset),
    badges: new InMemoryBadgeRepository(dataset),
    pushSubscriptions: new InMemoryPushSubscriptionRepository(dataset),
    reminderLog: new InMemoryReminderLogRepository(dataset),
  };
}
