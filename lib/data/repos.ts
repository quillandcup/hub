import { InMemoryAttendanceRepository, SupabaseAttendanceRepository, type AttendanceRepository } from "./attendance";
import type { Db } from "./db";
import { InMemoryDataset } from "./in-memory";
import { InMemoryMemberRepository, SupabaseMemberRepository, type MemberRepository } from "./members";
import { InMemoryBadgeRepository, SupabaseBadgeRepository, type BadgeRepository } from "./badges";
import { InMemoryAliasRepository, SupabaseAliasRepository, type AliasRepository } from "./aliases";
import { InMemoryPushSubscriptionRepository, SupabasePushSubscriptionRepository, type PushSubscriptionRepository } from "./push-subscriptions";
import { InMemoryReminderLogRepository, SupabaseReminderLogRepository, type ReminderLogRepository } from "./reminder-log";
import { InMemoryNotificationRepository, SupabaseNotificationRepository, type NotificationRepository } from "./notifications";
import { InMemoryPrickleRepository, SupabasePrickleRepository, type PrickleRepository } from "./prickles";
import { InMemoryMemberDirectoryRepository, SupabaseMemberDirectoryRepository, type MemberDirectoryRepository } from "./member-directory";
import { InMemoryChatRepository, SupabaseChatRepository, type ChatRepository } from "./chat";
import { InMemorySlackUserRepository, SupabaseSlackUserRepository, type SlackUserRepository } from "./slack-users";
import { InMemoryCalendarEventRepository, SupabaseCalendarEventRepository, type CalendarEventRepository } from "./calendar-events";
import { InMemoryUnmatchedEventRepository, SupabaseUnmatchedEventRepository, type UnmatchedEventRepository } from "./unmatched-events";
import { InMemoryProfileRepository, SupabaseProfileRepository, type ProfileRepository } from "./profiles";
import { InMemoryActivityRepository, SupabaseActivityRepository, type ActivityRepository } from "./activities";
import { InMemoryEventRepository, SupabaseEventRepository, type EventRepository } from "./events";
import { InMemoryWritingRepository, SupabaseWritingRepository, type WritingRepository } from "./writing";
import { InMemoryPrickleScheduleRepository, SupabasePrickleScheduleRepository, type PrickleScheduleRepository } from "./prickle-schedules";
import { InMemoryProgramRepository, SupabaseProgramRepository, type ProgramRepository } from "./programs";
import { InMemoryZoomRepository, SupabaseZoomRepository, type ZoomRepository } from "./zoom";
import { InMemoryMediaRepository, SupabaseMediaRepository, type MediaRepository } from "./media";
import { InMemoryKajabiCourseRepository, SupabaseKajabiCourseRepository, type KajabiCourseRepository } from "./kajabi-courses";
import { InMemoryBillingRepository, SupabaseBillingRepository, type BillingRepository } from "./billing";
import { InMemoryMemberStatusRepository, SupabaseMemberStatusRepository, type MemberStatusRepository } from "./member-status-overrides";
import { InMemoryProspectRepository, SupabaseProspectRepository, type ProspectRepository } from "./prospects";
import { InMemoryBookRepository, SupabaseBookRepository, type BookRepository } from "./books";
import { InMemoryPrickleActivityRepository, SupabasePrickleActivityRepository, type PrickleActivityRepository } from "./prickle-activity";
import { InMemoryCalendarFeedRepository, SupabaseCalendarFeedRepository, type CalendarFeedRepository } from "./calendar-feed";
import { InMemoryCalendarSyncStateRepository, SupabaseCalendarSyncStateRepository, type CalendarSyncStateRepository } from "./calendar-sync-state";

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
  aliases: AliasRepository;
  writing: WritingRepository;
  events: EventRepository;
  prickleSchedules: PrickleScheduleRepository;
  activities: ActivityRepository;
  directory: MemberDirectoryRepository;
  profiles: ProfileRepository;
  calendarEvents: CalendarEventRepository;
  slackUsers: SlackUserRepository;
  unmatchedEvents: UnmatchedEventRepository;
  media: MediaRepository;
  zoom: ZoomRepository;
  programs: ProgramRepository;
  chat: ChatRepository;
  kajabiCourses: KajabiCourseRepository;
  billing: BillingRepository;
  memberStatus: MemberStatusRepository;
  books: BookRepository;
  prickleActivity: PrickleActivityRepository;
  calendarFeed: CalendarFeedRepository;
  calendarSyncState: CalendarSyncStateRepository;
  prospects: ProspectRepository;
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
    aliases: new SupabaseAliasRepository(db),
    writing: new SupabaseWritingRepository(db),
    events: new SupabaseEventRepository(db),
    prickleSchedules: new SupabasePrickleScheduleRepository(db),
    activities: new SupabaseActivityRepository(db),
    directory: new SupabaseMemberDirectoryRepository(db),
    profiles: new SupabaseProfileRepository(db),
    calendarEvents: new SupabaseCalendarEventRepository(db),
    slackUsers: new SupabaseSlackUserRepository(db),
    unmatchedEvents: new SupabaseUnmatchedEventRepository(db),
    media: new SupabaseMediaRepository(db),
    zoom: new SupabaseZoomRepository(db),
    programs: new SupabaseProgramRepository(db),
    chat: new SupabaseChatRepository(db),
    kajabiCourses: new SupabaseKajabiCourseRepository(db),
    billing: new SupabaseBillingRepository(db),
    memberStatus: new SupabaseMemberStatusRepository(db),
    books: new SupabaseBookRepository(db),
    prickleActivity: new SupabasePrickleActivityRepository(db),
    calendarFeed: new SupabaseCalendarFeedRepository(db),
    calendarSyncState: new SupabaseCalendarSyncStateRepository(db),
    prospects: new SupabaseProspectRepository(db),
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
    aliases: new InMemoryAliasRepository(dataset),
    writing: new InMemoryWritingRepository(dataset),
    events: new InMemoryEventRepository(dataset),
    prickleSchedules: new InMemoryPrickleScheduleRepository(dataset),
    activities: new InMemoryActivityRepository(dataset),
    directory: new InMemoryMemberDirectoryRepository(dataset),
    profiles: new InMemoryProfileRepository(dataset),
    calendarEvents: new InMemoryCalendarEventRepository(dataset),
    slackUsers: new InMemorySlackUserRepository(dataset),
    unmatchedEvents: new InMemoryUnmatchedEventRepository(dataset),
    media: new InMemoryMediaRepository(dataset),
    zoom: new InMemoryZoomRepository(dataset),
    programs: new InMemoryProgramRepository(dataset),
    chat: new InMemoryChatRepository(dataset),
    kajabiCourses: new InMemoryKajabiCourseRepository(dataset),
    billing: new InMemoryBillingRepository(dataset),
    memberStatus: new InMemoryMemberStatusRepository(dataset),
    books: new InMemoryBookRepository(dataset),
    prickleActivity: new InMemoryPrickleActivityRepository(dataset),
    calendarFeed: new InMemoryCalendarFeedRepository(dataset),
    calendarSyncState: new InMemoryCalendarSyncStateRepository(dataset),
    prospects: new InMemoryProspectRepository(dataset),
  };
}
