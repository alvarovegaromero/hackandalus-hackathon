import { scenarioPackSchema } from "../pack";

// Fictitious wildfire in the urban-forest interface of Sierra Bermeja (Malaga).
// Points are invented on real geography; "Los Pinares" does not exist.
const at = (lat: number, lon: number, placeName: string) => ({ lat, lon, accuracyM: 0, placeName });

const pinares = at(36.5052, -5.1011, "Los Pinares");
const jubrique = at(36.5964, -5.1547, "Jubrique");
const camping = at(36.5318, -5.1189, "Camping Sierra Bermeja");
const sierra = at(36.5203, -5.1302, "Sierra Bermeja");
const a397 = at(36.6011, -5.0872, "A-397 km 12");
const ma8301 = at(36.5475, -5.1622, "MA-8301");
const hospital = at(36.4949, -4.9541, "Hospital Costa del Sol");

export const sierraBermeja = scenarioPackSchema.parse({
  id: "sierra-bermeja-wildfire",
  name: "Incendio forestal en Sierra Bermeja",
  durationMin: 70,
  facts: [
    { id: "fire-pinares", kind: "fire_activity", entityLabel: "Los Pinares", location: pinares, initial: "activo", alternatives: ["extinguido"] },
    { id: "fire-jubrique", kind: "fire_activity", entityLabel: "Jubrique", location: jubrique, initial: "activo", alternatives: ["extinguido"] },
    { id: "fire-camping", kind: "fire_activity", entityLabel: "el camping", location: camping, initial: "activo", alternatives: ["extinguido"] },
    { id: "wind", kind: "wind_direction", entityLabel: "viento", location: sierra, initial: "NE", alternatives: ["N", "E", "SO"] },
    { id: "road-a397", kind: "road_status", entityLabel: "A-397", location: a397, initial: "abierta", alternatives: ["cortada"] },
    { id: "road-ma8301", kind: "road_status", entityLabel: "MA-8301", location: ma8301, initial: "abierta", alternatives: ["cortada"] },
    { id: "sms-provider", kind: "comms_status", entityLabel: "proveedor de SMS", location: sierra, initial: "operativo", alternatives: ["caido"] },
    { id: "camping-headcount", kind: "headcount", entityLabel: "el camping", location: camping, initial: 120, alternatives: [100, 150], unit: "personas" },
    { id: "beds-costa-del-sol", kind: "bed_availability", entityLabel: "Hospital Costa del Sol", location: hospital, initial: 12, alternatives: [4, 20], unit: "camas" },
  ],
  sources: [
    { id: "citizens-call", channel: "citizen_call", reliability: 0.75, delayMin: [0, 3], lossRate: 0.05, accuracyM: 300 },
    { id: "citizens-sms", channel: "sms", reliability: 0.7, delayMin: [1, 6], lossRate: 0.1, accuracyM: 500 },
    { id: "sensor-forest", channel: "sensor", reliability: 0.97, delayMin: [0, 1], lossRate: 0, accuracyM: 50 },
    { id: "road-api", channel: "sensor", reliability: 0.95, delayMin: [0, 2], lossRate: 0, accuracyM: 20 },
    { id: "comms-monitor", channel: "sensor", reliability: 0.95, delayMin: [0, 1], lossRate: 0, accuracyM: 0 },
    { id: "mayor", channel: "verification", reliability: 0.9, delayMin: [2, 5], lossRate: 0.1, accuracyM: 50 },
    { id: "fire-chief", channel: "verification", reliability: 0.95, delayMin: [1, 3], lossRate: 0.05, accuracyM: 50 },
    { id: "hospital-desk", channel: "verification", reliability: 0.9, delayMin: [1, 4], lossRate: 0.05, accuracyM: 20 },
  ],
  templates: {
    fire_activity: [
      "Veo llamas y mucho humo en {entity}, el fuego esta {value}",
      "Incendio {value} cerca de {entity}, se ve desde la carretera",
      "Huele fuerte a humo por {entity}, creo que el fuego sigue {value}",
    ],
    wind_direction: [
      "El viento viene del {value} y sopla fuerte",
      "Ahora mismo el viento es del {value}, el humo se mueve con el",
    ],
    road_status: [
      "Carretera {entity}: {value}",
      "Acabamos de pasar por la {entity} y esta {value}",
    ],
    comms_status: ["Monitor de comunicaciones: {entity} {value}"],
    headcount: [
      "Aqui en {entity} somos unas {value} personas y nadie nos ha dicho nada",
      "Calculo {value} personas en {entity}",
    ],
    bed_availability: ["Tenemos {value} camas libres en {entity}"],
  },
  events: [
    {
      id: "t0-burst", atMin: 0, kind: "noise_burst", label: "Llegada inicial de avisos",
      effects: [
        { type: "witness", factId: "fire-pinares", count: 12, sourceIds: ["citizens-call", "citizens-sms"] },
        { type: "witness", factId: "fire-jubrique", count: 10, sourceIds: ["citizens-call", "citizens-sms"] },
        { type: "witness", factId: "fire-camping", count: 8, sourceIds: ["citizens-call", "citizens-sms"] },
        { type: "witness", factId: "fire-pinares", count: 1, sourceIds: ["sensor-forest"] },
        { type: "witness", factId: "fire-jubrique", count: 1, sourceIds: ["sensor-forest"] },
        { type: "witness", factId: "wind", count: 3, sourceIds: ["citizens-call"] },
        { type: "witness", factId: "wind", count: 1, sourceIds: ["sensor-forest"] },
        { type: "witness", factId: "road-a397", count: 1, sourceIds: ["road-api"] },
        { type: "hoax", kind: "fire_activity", entityLabel: "Ronda centro", value: "activo", location: at(36.7426, -5.1672, "Ronda centro"), count: 3, sourceIds: ["citizens-sms"] },
      ],
    },
    {
      id: "chaos-wind-sw", atMin: 30, kind: "chaos", label: "El viento gira a SO",
      effects: [
        { type: "set_fact", factId: "wind", value: "SO" },
        { type: "witness", factId: "wind", count: 4, sourceIds: ["citizens-call"] },
        { type: "witness", factId: "wind", count: 1, sourceIds: ["sensor-forest"] },
      ],
    },
    {
      id: "chaos-a397-closed", atMin: 40, kind: "chaos", label: "Corte de la A-397",
      effects: [
        { type: "set_fact", factId: "road-a397", value: "cortada" },
        { type: "witness", factId: "road-a397", count: 3, sourceIds: ["citizens-call", "citizens-sms"] },
        { type: "witness", factId: "road-a397", count: 1, sourceIds: ["road-api"] },
      ],
    },
    {
      id: "chaos-sms-down", atMin: 50, kind: "chaos", label: "Cae el proveedor de SMS",
      effects: [
        { type: "set_fact", factId: "sms-provider", value: "caido" },
        { type: "witness", factId: "sms-provider", count: 1, sourceIds: ["comms-monitor"] },
      ],
    },
    {
      id: "camping-growth", atMin: 60, kind: "scheduled", label: "50 personas mas en el camping",
      effects: [
        { type: "set_fact", factId: "camping-headcount", value: 170 },
        { type: "witness", factId: "camping-headcount", count: 3, sourceIds: ["citizens-call"] },
      ],
    },
  ],
});
