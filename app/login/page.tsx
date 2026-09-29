import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import { slackHomeDeepLink } from "@/lib/slack-sign-in";

export const metadata: Metadata = {
  title: "Login",
};

export default function LoginPage() {
  return <LoginForm slackHomeUrl={slackHomeDeepLink()} />;
}
