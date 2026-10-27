import type { AttendanceRow } from "./attendance";
import type { BadgeLevel, BadgeType, MemberBadge } from "./badges";
import type { EmailAliasRow, NameAliasRow } from "./aliases";
import type { PushSubscriptionRow } from "./push-subscriptions";
import type { ReminderLogRow } from "./reminder-log";
import type { InAppNotificationRow, NotificationPreference } from "./notifications";
import type { Prickle, PrickleType } from "./prickles";
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
  /** Only what badges link to: an event's title and its member-facing slug. */
  events: { id: string; title: string; slug: string }[];
  writingProjects: WritingProjectRow[];
  writingGoals: WritingGoalRow[];
  writingEntries: WritingEntryRow[];
  writingBalances: WritingBalanceRow[];

  constructor(
    init: Partial<
      Pick<InMemoryDataset, "members" | "prickleTypes" | "prickles" | "attendance" | "notificationPreferences" | "inAppNotifications" | "badgeTypes" | "badgeLevels" | "memberBadges" | "events" | "pushSubscriptions" | "reminderLog" | "nameAliases" | "emailAliases" | "writingProjects" | "writingGoals" | "writingEntries" | "writingBalances">
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
    this.writingProjects = (init.writingProjects ?? []).map((row) => ({ ...row }));
    this.writingGoals = (init.writingGoals ?? []).map((row) => ({ ...row }));
    this.writingEntries = (init.writingEntries ?? []).map((row) => ({ ...row }));
    this.writingBalances = (init.writingBalances ?? []).map((row) => ({ ...row }));
  }
}
