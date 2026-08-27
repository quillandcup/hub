import type { Metadata } from "next";
import MemberOverridesClient from "./MemberOverridesClient";

export const metadata: Metadata = {
  title: "Member Status Overrides",
};

export default function MemberOverridesPage() {
  return <MemberOverridesClient />;
}
