import type { Metadata } from "next";
import SegmentsClient from "./SegmentsClient";

export const metadata: Metadata = {
  title: "Segments",
};

export default function SegmentsPage() {
  return <SegmentsClient />;
}
