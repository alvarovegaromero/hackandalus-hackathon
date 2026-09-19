import type { Metadata } from "next";
import EmergencyDrills from "@/components/emergency-drills";
import "./drills.css";

export const metadata: Metadata = {
  title: "Emergency drills | Far0",
  description: "Rehearse earthquake and wildfire response in a schematic 3D training twin.",
};

export default function DrillsPage() {
  return <EmergencyDrills />;
}
