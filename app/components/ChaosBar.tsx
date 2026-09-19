"use client";

// Botones de caos: los pulsa el jurado en directo. Grandes, claros y con el
// efecto escrito debajo. "Elegid qué rompemos."

import { Flame, RadioTower, Route, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChaosButton {
  id: string;
  label: string;
  effect: string;
  icon: "wind" | "road" | "sms" | "people";
  accent: string;
}

interface Props {
  busy: string | null;
  onFire: (id: string) => void;
}

const buttons: ChaosButton[] = [
  {
    id: "wind",
    label: "Girar el viento",
    effect: "El frente cambia de dirección",
    icon: "wind",
    accent: "text-[#a11b12] bg-[#fde4e2]",
  },
  {
    id: "road",
    label: "Cortar la carretera",
    effect: "Se pierde la vía A-397",
    icon: "road",
    accent: "text-[#96490f] bg-[#fdf0e0]",
  },
  {
    id: "sms",
    label: "Tumbar el SMS",
    effect: "Cae el canal de mensajería",
    icon: "sms",
    accent: "text-[#543a99] bg-[#eee9fb]",
  },
  {
    id: "people",
    label: "+50 personas",
    effect: "Llegan más desplazados de los previstos",
    icon: "people",
    accent: "text-[#17527f] bg-[#e6f0fa]",
  },
];

function renderIcon(kind: ChaosButton["icon"], accentClass: string) {
  const iconProps = { size: 20, "aria-hidden": "true" as const };
  return (
    <div
      className={cn("p-1.5 rounded-[8px] flex items-center justify-center shrink-0", accentClass)}
    >
      {kind === "wind" && <Flame {...iconProps} />}
      {kind === "road" && <Route {...iconProps} />}
      {kind === "sms" && <RadioTower {...iconProps} />}
      {kind === "people" && <Users {...iconProps} />}
    </div>
  );
}

export default function ChaosBar({ busy, onFire }: Props) {
  return (
    <section
      className="rounded-[16px] border border-[#d8d4c9] bg-white p-4 shadow-xs tracking-[-0.15px]"
      aria-label="Romper algo en directo"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#5d5d5d]">
          Inyección de Caos · Jurado
        </p>
        <span className="text-[12px] text-[#9e9e9e]">
          Haz clic para alterar el escenario en vivo
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {buttons.map((button) => (
          <button
            key={button.id}
            type="button"
            className="flex items-start gap-3 p-3 rounded-[12px] border border-[#d8d4c9] bg-white text-left hover:border-[#292929] hover:bg-neutral-50/70 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none group"
            onClick={() => onFire(button.id)}
            disabled={busy !== null}
            aria-label={`${button.label}. ${button.effect}.`}
          >
            {renderIcon(button.icon, button.accent)}
            <div className="flex flex-col min-w-0">
              <b className="text-[13px] font-semibold text-[#292929] group-hover:text-black transition-colors">
                {button.label}
              </b>
              <small className="text-[12px] text-[#5d5d5d] leading-snug mt-0.5 truncate">
                {button.effect}
              </small>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
