import type { Metadata } from "next";
import EmergencyDrills from "@/components/emergency-drills";
import "./drills.css";

export const metadata: Metadata = {
  title: "Wildfire drills | Far0",
  description:
    "Rehearse wildfire response in 3D, review decisions and reuse approved lessons in the next drill.",
};

export default function DrillsPage() {
  return <EmergencyDrills />;
}
