import type { Metadata } from "next";
import EmergencyDrills from "@/components/emergency-drills";
import "./drills.css";

export const metadata: Metadata = {
  title: "Emergency drills | Far0",
  description:
    "Run, replay and learn from earthquake and wildfire drills in an animated 3D training city.",
};

export default function DrillsPage() {
  return <EmergencyDrills />;
}
