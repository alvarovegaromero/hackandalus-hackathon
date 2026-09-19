declare module "lucide-react" {
  import * as React from "react";

  export interface LucideProps extends React.SVGProps<SVGSVGElement> {
    size?: string | number;
    color?: string;
    strokeWidth?: string | number;
    absoluteStrokeWidth?: boolean;
    className?: string;
  }

  export type LucideIcon = React.ForwardRefExoticComponent<
    LucideProps & React.RefAttributes<SVGSVGElement>
  >;

  export const AlertTriangle: LucideIcon;
  export const ArrowDown: LucideIcon;
  export const ArrowLeft: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const ArrowUp: LucideIcon;
  export const Ban: LucideIcon;
  export const BrainCircuit: LucideIcon;
  export const Check: LucideIcon;
  export const CheckCircle2: LucideIcon;
  export const CircleAlert: LucideIcon;
  export const CircleDot: LucideIcon;
  export const CircleHelp: LucideIcon;
  export const Clock3: LucideIcon;
  export const Crosshair: LucideIcon;
  export const Flame: LucideIcon;
  export const GitCompareArrows: LucideIcon;
  export const HelpCircle: LucideIcon;
  export const History: LucideIcon;
  export const Layers: LucideIcon;
  export const Loader2: LucideIcon;
  export const Mail: LucideIcon;
  export const MapPin: LucideIcon;
  export const MessageSquare: LucideIcon;
  export const Minus: LucideIcon;
  export const PauseCircle: LucideIcon;
  export const PhoneCall: LucideIcon;
  export const Play: LucideIcon;
  export const Plus: LucideIcon;
  export const RadioTower: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const RotateCcw: LucideIcon;
  export const Route: LucideIcon;
  export const Send: LucideIcon;
  export const ShieldAlert: LucideIcon;
  export const Siren: LucideIcon;
  export const Square: LucideIcon;
  export const Ticket: LucideIcon;
  export const Truck: LucideIcon;
  export const Users: LucideIcon;
  export const Webhook: LucideIcon;
  export const Wind: LucideIcon;
  export const X: LucideIcon;
  export const Zap: LucideIcon;

  export const icons: Record<string, LucideIcon>;
  const defaultExport: Record<string, LucideIcon>;
  export default defaultExport;
}
