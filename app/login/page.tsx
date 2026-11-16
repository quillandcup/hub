import type { Metadata } from "next";
import { PUBLIC_PAGE_TITLES } from "@/lib/page-title";
import LoginForm from "./LoginForm";
import { slackHomeDeepLink } from "@/lib/slack-sign-in";

export const metadata: Metadata = {
  title: PUBLIC_PAGE_TITLES.login,
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  const { error, mode } = await searchParams;
  return <LoginForm slackHomeUrl={slackHomeDeepLink()} callbackFailed={error === "auth_callback_failed"} codeMode={mode === "code"} />;
}
