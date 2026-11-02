import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import { slackHomeDeepLink } from "@/lib/slack-sign-in";

export const metadata: Metadata = {
  title: "Login",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <LoginForm slackHomeUrl={slackHomeDeepLink()} callbackFailed={error === "auth_callback_failed"} />;
}
