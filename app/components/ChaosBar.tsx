"use client";

// Botones de caos: los pulsa el jurado en directo. Grandes, claros y con el
// efecto escrito debajo. "Elegid qué rompemos."

import { Flame, RadioTower, Route, Users } from "lucide-react";

export interface ChaosButton {
  id: string;
  label: string;
  effect: string;
  icon: "wind" | "road" | "sms" | "people";
}

interface Props {
  busy: string | null;
  onFire: (id: string) => void;
}

const buttons: ChaosButton[] = [
  { id: "wind", label: "Girar el viento", effect: "El frente cambia de dirección", icon: "wind" },
  { id: "road", label: "Cortar la carretera", effect: "Se pierde una vía de acceso", icon: "road" },
  { id: "sms", label: "Tumbar el SMS", effect: "Cae el canal de mensajería", icon: "sms" },
  { id: "people", label: "+50 personas", effect: "Llegan más desplazados de los previstos", icon: "people" }
];

function icon(kind: ChaosButton["icon"]) {
  if (kind === "wind") return <Flame size={22} aria-hidden="true" />;
  if (kind === "road") return <Route size={22} aria-hidden="true" />;
  if (kind === "sms") return <RadioTower size={22} aria-hidden="true" />;
  return <Users size={22} aria-hidden="true" />;
}

export default function ChaosBar({ busy, onFire }: Props) {
  return (
    <section className="chaos-bar" aria-label="Romper algo en directo">
      <p className="chaos-title">Elegid qué rompemos</p>
      <div className="chaos-buttons">
        {buttons.map((button) => (
          <button
            key={button.id}
            className="chaos"
            onClick={() => onFire(button.id)}
            disabled={busy !== null}
            aria-label={`${button.label}. ${button.effect}.`}
          >
            {icon(button.icon)}
            <b>{button.label}</b>
            <small>{button.effect}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
