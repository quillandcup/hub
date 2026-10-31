import type { ActivityRow } from "./activities";
import type { AttendanceRow } from "./attendance";
import type { BadgeLevel, BadgeType, MemberBadge } from "./badges";
import type { EmailAliasRow, NameAliasRow } from "./aliases";
import type { PushSubscriptionRow } from "./push-subscriptions";
import type { ReminderLogRow } from "./reminder-log";
import type { InAppNotificationRow, NotificationPreference } from "./notifications";
import type { EventAttendeeRow, EventPhotoRow, EventRow } from "./events";
import type { MediaAsset } from "./media";
import type { BookSeed } from "./books";
import type { CalendarSourceEvent } from "./calendar-events";
import type { SlackUserSeed } from "./slack-users";
import type { NewKajabiMember, NewSubscriptionHistory, KajabiContactSeed, KajabiCustomerSeed, KajabiOfferSeed, KajabiPurchaseSeed, StripeCustomerSeed, StripeProductSeed, StripeSubscriptionSeed } from "./billing";
import type { IgnoredZoomNameRow, ZoomAttendeeRow, ZoomMeetingRow } from "./zoom";
import type { UnmatchedEvent } from "./unmatched-events";
import type { ChatChannelMemberSeed, ChatChannelSeed, ChatGapFillSeed, ChatMessageContentSeed, ChatMessageSeed, ChatReactionSeed, ChatSlackAuthorSeed } from "./chat";
import type { UserProfileSeed } from "./profiles";
import type { ScheduleRow } from "./prickle-schedules";
import type { Prickle, PrickleType } from "./prickles";
import type { Program, ProgramCohort, ProgramEnrollment } from "./programs";
import type { HiatusRow, JoinDateOverrideRow, ProfileOverrideStoredRow, StatusOverrideRow } from "./member-status-overrides";
import type { KajabiCourse, KajabiCourseOffer, KajabiLesson, KajabiLessonFile, KajabiModule } from "./kajabi-courses";
import type { Database } from "./database.types";
import type { WritingBalanceRow, WritingEntryRow, WritingGoalRow, WritingProjectRow } from "./writing";

/** A member as the in-memory repositories need them: names for hosts and attendees, and the email only admins may see. */
export type MemberSeed = {
  id: string;
  name: string;
  displayName?: string | null;
  email?: string | null;
  /** "active" when not given. */
  status?: string;
  /** "kajabi" when not given. */
  source?: string;
  /** The Supabase Auth user this member signs in as. */
  userId?: string | null;
  staffRole?: string | null;
  kajabiId?: string | null;
  stripeCustomerId?: string | null;
  photoUrl?: string | null;
  bio?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  twitterUrl?: string | null;
  birthdayMonth?: number | null;
  birthdayDay?: number | null;
  selfServiceNameChangedAt?: string | null;
  /** When the row was last written; the Kajabi processing run touches it for every Kajabi member. */
  updatedAt?: string | null;
  totalActiveMonths?: number;
  joinedAt?: string;
  firstJoinedAt?: string | null;
  mostRecentJoinedAt?: string | null;
};

/**
 * The typed tables behind the in-memory repositories. Joins (a prickle's type and host, an
 * attendee's name) read from here, so every in-memory repository over one dataset sees the same
 * world, the way the Supabase ones see one database. Build one in a test, or as a seed profile
 * for demos and docs, with typed rows instead of SQL.
 */
export class InMemoryDataset {
  members: MemberSeed[];
  prickleTypes: PrickleType[];
  prickles: Prickle[];
  attendance: AttendanceRow[];
  notificationPreferences: NotificationPreference[];
  inAppNotifications: InAppNotificationRow[];
  nameAliases: NameAliasRow[];
  emailAliases: EmailAliasRow[];
  pushSubscriptions: PushSubscriptionRow[];
  reminderLog: ReminderLogRow[];
  badgeTypes: BadgeType[];
  badgeLevels: BadgeLevel[];
  memberBadges: MemberBadge[];
  /** Events: at least the title and member-facing slug the badges link to; the other columns are optional. */
  events: EventRow[];
  /** Hosting schedules (a host's slot for a month). */
  prickleSchedules: ScheduleRow[];
  writingProjects: WritingProjectRow[];
  writingGoals: WritingGoalRow[];
  writingEntries: WritingEntryRow[];
  writingBalances: WritingBalanceRow[];
  /** The member activity log. */
  activities: ActivityRow[];
  /** Signed-in users' profiles (role, time zones), keyed by Supabase Auth user id. */
  userProfiles: UserProfileSeed[];
  /** The Bronze copy of the Google Calendar (`bronze.calendar_events`). */
  calendarEvents: CalendarSourceEvent[];
  /** The Bronze copy of the workspace's Slack users (`bronze.slack_users`). */
  slackUsers: SlackUserSeed[];
  /** The Bronze copy of Zoom attendance (`bronze.zoom_attendees`, `bronze.zoom_meetings`) and the names ignored everywhere. */
  zoomAttendees: ZoomAttendeeRow[];
  zoomMeetings: ZoomMeetingRow[];
  ignoredZoomNames: IgnoredZoomNameRow[];
  /** The calendar items queued for review and the decisions made on them (`unmatched_calendar_events`). */
  unmatchedEvents: UnmatchedEvent[];
  /** Programs, their cohorts and the members enrolled in them. */
  programs: Program[];
  programCohorts: ProgramCohort[];
  programEnrollments: ProgramEnrollment[];
  /** The Hub's mirror of bridged Slack conversations (chat), one array per table. */
  chatChannels: ChatChannelSeed[];
  chatChannelMembers: ChatChannelMemberSeed[];
  chatMessages: ChatMessageSeed[];
  chatMessageContents: ChatMessageContentSeed[];
  chatReactions: ChatReactionSeed[];
  chatSlackAuthors: ChatSlackAuthorSeed[];
  chatGapFills: ChatGapFillSeed[];
  /** The media library (`media_assets`). */
  mediaAssets: MediaAsset[];
  /** Courses, modules and lessons, by which library assets they show (what the media library's usage list needs). */
  courseImages: { id: string; kind: "course" | "module" | "lesson"; title: string; asset_ids: string[] }[];
  /** Members' bookshelves (`member_books`): the id, owner, title, publish date and cover asset are required, the other columns default. */
  memberBooks: BookSeed[];
  // --- Kajabi course Bronze (KajabiCourseRepository) ---
  kajabiCourses: KajabiCourse[];
  kajabiModules: KajabiModule[];
  kajabiLessons: KajabiLesson[];
  kajabiLessonFiles: KajabiLessonFile[];
  kajabiCourseOffers: KajabiCourseOffer[];
  kajabiProductProgress: Database["bronze"]["Tables"]["kajabi_product_progress"]["Row"][];
  kajabiLessonProgress: Database["bronze"]["Tables"]["kajabi_lesson_progress"]["Row"][];
  /** The Bronze copy of Kajabi and Stripe billing (`bronze.kajabi_contacts`, `kajabi_customers`, `kajabi_purchases`, `kajabi_offers`, `stripe_customers`, `stripe_products`, `stripe_subscriptions`). */
  kajabiContacts: KajabiContactSeed[];
  kajabiCustomers: KajabiCustomerSeed[];
  kajabiPurchases: KajabiPurchaseSeed[];
  kajabiOffers: KajabiOfferSeed[];
  stripeCustomers: StripeCustomerSeed[];
  stripeProducts: StripeProductSeed[];
  stripeSubscriptions: StripeSubscriptionSeed[];
  /** The members export (`bronze.kajabi_members`, append only) and the subscription export (`bronze.subscription_history`), as the imports wrote them. */
  kajabiMembers: NewKajabiMember[];
  subscriptionHistory: NewSubscriptionHistory[];
  // --- member status and profile overrides (MemberStatusRepository) ---
  /** Hiatus windows (`member_hiatus_history`). */
  memberHiatuses: HiatusRow[];
  /** Admin grants of membership (`member_status_overrides`). */
  memberStatusOverrides: StatusOverrideRow[];
  /** Legacy join-date corrections (`member_join_date_overrides`). */
  memberJoinDateOverrides: JoinDateOverrideRow[];
  /** What members edited in their profile (`member_profile_overrides`). */
  memberProfileOverrides: ProfileOverrideStoredRow[];
  // --- event photos ---
  eventPhotos: EventPhotoRow[];
  // --- calendar sync ---
  /** Attendees of events: the calendar sync keeps an event that has attendees or photos. */
  eventAttendees: EventAttendeeRow[];

  constructor(
    init: Partial<
      Pick<InMemoryDataset, "members" | "prickleTypes" | "prickles" | "attendance" | "notificationPreferences" | "inAppNotifications" | "badgeTypes" | "badgeLevels" | "memberBadges" | "events" | "pushSubscriptions" | "reminderLog" | "nameAliases" | "emailAliases" | "writingProjects" | "writingGoals" | "writingEntries" | "writingBalances" | "eventPhotos" | "eventAttendees" | "prickleSchedules" | "activities" | "userProfiles" | "calendarEvents" | "slackUsers" | "zoomAttendees" | "zoomMeetings" | "ignoredZoomNames" | "unmatchedEvents" | "programs" | "programCohorts" | "programEnrollments" | "chatChannels" | "chatChannelMembers" | "chatMessages" | "chatMessageContents" | "chatReactions" | "chatSlackAuthors" | "chatGapFills" | "mediaAssets" | "memberBooks" | "courseImages" | "kajabiCourses" | "kajabiModules" | "kajabiLessons" | "kajabiLessonFiles" | "kajabiCourseOffers" | "kajabiProductProgress" | "kajabiLessonProgress" | "kajabiContacts" | "kajabiCustomers" | "kajabiPurchases" | "kajabiOffers" | "stripeCustomers" | "stripeProducts" | "stripeSubscriptions" | "kajabiMembers" | "subscriptionHistory" | "memberHiatuses" | "memberStatusOverrides" | "memberJoinDateOverrides" | "memberProfileOverrides">

    > = {},
  ) {
    this.members = (init.members ?? []).map((row) => ({ ...row }));
    this.prickleTypes = (init.prickleTypes ?? []).map((row) => ({ ...row }));
    this.prickles = (init.prickles ?? []).map((row) => ({ ...row }));
    this.attendance = (init.attendance ?? []).map((row) => ({ ...row }));
    this.notificationPreferences = (init.notificationPreferences ?? []).map((row) => ({ ...row }));
    this.inAppNotifications = (init.inAppNotifications ?? []).map((row) => ({ ...row }));
    this.nameAliases = (init.nameAliases ?? []).map((row) => ({ ...row }));
    this.emailAliases = (init.emailAliases ?? []).map((row) => ({ ...row }));
    this.pushSubscriptions = (init.pushSubscriptions ?? []).map((row) => ({ ...row }));
    this.reminderLog = (init.reminderLog ?? []).map((row) => ({ ...row }));
    this.badgeTypes = (init.badgeTypes ?? []).map((row) => ({ ...row }));
    this.badgeLevels = (init.badgeLevels ?? []).map((row) => ({ ...row }));
    this.memberBadges = (init.memberBadges ?? []).map((row) => ({ ...row }));
    this.events = (init.events ?? []).map((row) => ({ ...row }));
    this.eventAttendees = (init.eventAttendees ?? []).map((row) => ({ ...row }));
    this.prickleSchedules = (init.prickleSchedules ?? []).map((row) => ({ ...row }));
    this.writingProjects = (init.writingProjects ?? []).map((row) => ({ ...row }));
    this.writingGoals = (init.writingGoals ?? []).map((row) => ({ ...row }));
    this.writingEntries = (init.writingEntries ?? []).map((row) => ({ ...row }));
    this.writingBalances = (init.writingBalances ?? []).map((row) => ({ ...row }));
    this.activities = (init.activities ?? []).map((row) => ({ ...row }));
    this.userProfiles = (init.userProfiles ?? []).map((row) => ({ ...row }));
    this.calendarEvents = (init.calendarEvents ?? []).map((row) => ({ ...row }));
    this.slackUsers = (init.slackUsers ?? []).map((row) => ({ ...row }));
    this.zoomAttendees = (init.zoomAttendees ?? []).map((row) => ({ ...row }));
    this.zoomMeetings = (init.zoomMeetings ?? []).map((row) => ({ ...row }));
    this.ignoredZoomNames = (init.ignoredZoomNames ?? []).map((row) => ({ ...row }));
    this.unmatchedEvents = (init.unmatchedEvents ?? []).map((row) => ({ ...row }));
    this.programs = (init.programs ?? []).map((row) => ({ ...row }));
    this.programCohorts = (init.programCohorts ?? []).map((row) => ({ ...row }));
    this.programEnrollments = (init.programEnrollments ?? []).map((row) => ({ ...row }));
    this.chatChannels = (init.chatChannels ?? []).map((row) => ({ ...row }));
    this.chatChannelMembers = (init.chatChannelMembers ?? []).map((row) => ({ ...row }));
    this.chatMessages = (init.chatMessages ?? []).map((row) => ({ ...row }));
    this.chatMessageContents = (init.chatMessageContents ?? []).map((row) => ({ ...row }));
    this.chatReactions = (init.chatReactions ?? []).map((row) => ({ ...row }));
    this.chatSlackAuthors = (init.chatSlackAuthors ?? []).map((row) => ({ ...row }));
    this.chatGapFills = (init.chatGapFills ?? []).map((row) => ({ ...row }));
    this.mediaAssets = (init.mediaAssets ?? []).map((row) => ({ ...row }));
    this.memberBooks = (init.memberBooks ?? []).map((row) => ({ ...row }));
    this.courseImages = (init.courseImages ?? []).map((row) => ({ ...row, asset_ids: [...row.asset_ids] }));
    this.kajabiCourses = (init.kajabiCourses ?? []).map((row) => ({ ...row }));
    this.kajabiModules = (init.kajabiModules ?? []).map((row) => ({ ...row }));
    this.kajabiLessons = (init.kajabiLessons ?? []).map((row) => ({ ...row }));
    this.kajabiLessonFiles = (init.kajabiLessonFiles ?? []).map((row) => ({ ...row }));
    this.kajabiCourseOffers = (init.kajabiCourseOffers ?? []).map((row) => ({ ...row }));
    this.kajabiProductProgress = (init.kajabiProductProgress ?? []).map((row) => ({ ...row }));
    this.kajabiLessonProgress = (init.kajabiLessonProgress ?? []).map((row) => ({ ...row }));
    this.kajabiContacts = (init.kajabiContacts ?? []).map((row) => ({ ...row }));
    this.kajabiCustomers = (init.kajabiCustomers ?? []).map((row) => ({ ...row }));
    this.kajabiPurchases = (init.kajabiPurchases ?? []).map((row) => ({ ...row }));
    this.kajabiOffers = (init.kajabiOffers ?? []).map((row) => ({ ...row }));
    this.stripeCustomers = (init.stripeCustomers ?? []).map((row) => ({ ...row }));
    this.stripeProducts = (init.stripeProducts ?? []).map((row) => ({ ...row }));
    this.stripeSubscriptions = (init.stripeSubscriptions ?? []).map((row) => ({ ...row }));
    this.kajabiMembers = (init.kajabiMembers ?? []).map((row) => ({ ...row }));
    this.subscriptionHistory = (init.subscriptionHistory ?? []).map((row) => ({ ...row }));
    this.memberHiatuses = (init.memberHiatuses ?? []).map((row) => ({ ...row }));
    this.memberStatusOverrides = (init.memberStatusOverrides ?? []).map((row) => ({ ...row }));
    this.memberJoinDateOverrides = (init.memberJoinDateOverrides ?? []).map((row) => ({ ...row }));
    this.memberProfileOverrides = (init.memberProfileOverrides ?? []).map((row) => ({ ...row }));
    this.eventPhotos = (init.eventPhotos ?? []).map((row) => ({ ...row }));
    this.eventAttendees = (init.eventAttendees ?? []).map((row) => ({ ...row }));
  }
}
