import type { Metadata } from "next";
import ReconciliationClient from "./ReconciliationClient";

export const metadata: Metadata = {
  title: "Subscription Reconciliation",
};

export default function ReconciliationPage() {
  return <ReconciliationClient />;
}
