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
    accent: "text-danger bg-danger-soft",
  },
  {
    id: "road",
    label: "Cortar la carretera",
    effect: "Se pierde la vía A-397",
    icon: "road",
    accent: "text-warn bg-warn-soft",
  },
  {
    id: "sms",
    label: "Tumbar el SMS",
    effect: "Cae el canal de mensajería",
    icon: "sms",
    accent: "text-violet bg-violet-soft",
  },
  {
    id: "people",
    label: "+50 personas",
    effect: "Llegan más desplazados de los previstos",
    icon: "people",
    accent: "text-info bg-info-soft",
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
      className="rounded-[16px] border border-line bg-white p-4 shadow-xs tracking-[-0.15px]"
      aria-label="Romper algo en directo"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-blueprint-mid">
          Romper algo en directo
        </p>
        <span className="text-[12px] text-blueprint-light">Pulsa para alterar el escenario</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {buttons.map((button) => (
          <button
            key={button.id}
            type="button"
            className="flex items-start gap-3 p-3 rounded-[12px] border border-line bg-white text-left hover:border-blueprint-dark hover:bg-neutral-50/70 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none group"
            onClick={() => onFire(button.id)}
            disabled={busy !== null}
            aria-label={`${button.label}. ${button.effect}.`}
          >
            {renderIcon(button.icon, button.accent)}
            <div className="flex flex-col min-w-0">
              <b className="text-[13px] font-semibold text-blueprint-dark group-hover:text-black transition-colors">
                {button.label}
              </b>
              <small className="text-[12px] text-blueprint-mid leading-snug mt-0.5">
                {button.effect}
              </small>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
