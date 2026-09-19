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
  name: "Wildfire in Sierra Bermeja",
  durationMin: 70,
  facts: [
    {
      id: "fire-pinares",
      kind: "fire_activity",
      entityLabel: "Los Pinares",
      location: pinares,
      initial: "active",
      alternatives: ["extinguished"],
    },
    {
      id: "fire-jubrique",
      kind: "fire_activity",
      entityLabel: "Jubrique",
      location: jubrique,
      initial: "active",
      alternatives: ["extinguished"],
    },
    {
      id: "fire-camping",
      kind: "fire_activity",
      entityLabel: "Camping Sierra Bermeja",
      location: camping,
      initial: "active",
      alternatives: ["extinguished"],
    },
    {
      id: "wind",
      kind: "wind_direction",
      entityLabel: "wind",
      location: sierra,
      initial: "NE",
      alternatives: ["N", "E", "SO"],
    },
    {
      id: "road-a397",
      kind: "road_status",
      entityLabel: "A-397",
      location: a397,
      initial: "open",
      alternatives: ["blocked"],
    },
    {
      id: "road-ma8301",
      kind: "road_status",
      entityLabel: "MA-8301",
      location: ma8301,
      initial: "open",
      alternatives: ["blocked"],
    },
    {
      id: "sms-provider",
      kind: "comms_status",
      entityLabel: "SMS provider",
      location: sierra,
      initial: "operativo",
      alternatives: ["caido"],
    },
    {
      id: "camping-headcount",
      kind: "headcount",
      entityLabel: "Camping Sierra Bermeja",
      location: camping,
      initial: 120,
      alternatives: [100, 150],
      unit: "people",
    },
    {
      id: "beds-costa-del-sol",
      kind: "bed_availability",
      entityLabel: "Hospital Costa del Sol",
      location: hospital,
      initial: 12,
      alternatives: [4, 20],
      unit: "beds",
    },
  ],
  sources: [
    {
      id: "citizens-call",
      channel: "citizen_call",
      reliability: 0.75,
      delayMin: [0, 3],
      lossRate: 0.05,
      accuracyM: 300,
    },
    {
      id: "citizens-sms",
      channel: "sms",
      reliability: 0.7,
      delayMin: [1, 6],
      lossRate: 0.1,
      accuracyM: 500,
    },
    {
      id: "sensor-forest",
      channel: "sensor",
      reliability: 0.97,
      delayMin: [0, 1],
      lossRate: 0,
      accuracyM: 50,
    },
    {
      id: "road-api",
      channel: "sensor",
      reliability: 0.95,
      delayMin: [0, 2],
      lossRate: 0,
      accuracyM: 20,
    },
    {
      id: "comms-monitor",
      channel: "sensor",
      reliability: 0.95,
      delayMin: [0, 1],
      lossRate: 0,
      accuracyM: 0,
    },
    {
      id: "mayor",
      channel: "verification",
      reliability: 0.9,
      delayMin: [2, 5],
      lossRate: 0.1,
      accuracyM: 50,
    },
    {
      id: "fire-chief",
      channel: "verification",
      reliability: 0.95,
      delayMin: [1, 3],
      lossRate: 0.05,
      accuracyM: 50,
    },
    {
      id: "hospital-desk",
      channel: "verification",
      reliability: 0.9,
      delayMin: [1, 4],
      lossRate: 0.05,
      accuracyM: 20,
    },
  ],
  templates: {
    fire_activity: [
      "I see flames and heavy smoke in {entity}, the fire is {value}",
      "Fire {value} near {entity}, visible from the road",
      "Strong smell of smoke around {entity}, I think the fire is still {value}",
    ],
    wind_direction: [
      "The wind is coming from {value} and blowing hard",
      "Right now the wind is from {value}, smoke is moving with it",
    ],
    road_status: ["Road {entity}: {value}", "We just passed by {entity} and it is {value}"],
    comms_status: ["Communications monitor: {entity} {value}"],
    headcount: [
      "Here at {entity} there are about {value} people and nobody has told us anything",
      "I estimate {value} people in {entity}",
    ],
    bed_availability: ["We have {value} available beds in {entity}"],
  },
  events: [
    {
      id: "t0-burst",
      atMin: 0,
      kind: "noise_burst",
      label: "Initial arrival of reports",
      effects: [
        {
          type: "witness",
          factId: "fire-pinares",
          count: 12,
          sourceIds: ["citizens-call", "citizens-sms"],
        },
        {
          type: "witness",
          factId: "fire-jubrique",
          count: 10,
          sourceIds: ["citizens-call", "citizens-sms"],
        },
        {
          type: "witness",
          factId: "fire-camping",
          count: 8,
          sourceIds: ["citizens-call", "citizens-sms"],
        },
        { type: "witness", factId: "fire-pinares", count: 1, sourceIds: ["sensor-forest"] },
        { type: "witness", factId: "fire-jubrique", count: 1, sourceIds: ["sensor-forest"] },
        { type: "witness", factId: "wind", count: 3, sourceIds: ["citizens-call"] },
        { type: "witness", factId: "wind", count: 1, sourceIds: ["sensor-forest"] },
        { type: "witness", factId: "road-a397", count: 1, sourceIds: ["road-api"] },
        {
          type: "hoax",
          kind: "fire_activity",
          entityLabel: "Ronda centro",
          value: "active",
          location: at(36.7426, -5.1672, "Ronda centro"),
          count: 3,
          sourceIds: ["citizens-sms"],
        },
      ],
    },
    {
      id: "chaos-wind-sw",
      atMin: 30,
      kind: "chaos",
      label: "Wind shifts to SW",
      effects: [
        { type: "set_fact", factId: "wind", value: "SO" },
        { type: "witness", factId: "wind", count: 4, sourceIds: ["citizens-call"] },
        { type: "witness", factId: "wind", count: 1, sourceIds: ["sensor-forest"] },
      ],
    },
    {
      id: "chaos-a397-closed",
      atMin: 40,
      kind: "chaos",
      label: "A-397 road closure",
      effects: [
        { type: "set_fact", factId: "road-a397", value: "blocked" },
        {
          type: "witness",
          factId: "road-a397",
          count: 3,
          sourceIds: ["citizens-call", "citizens-sms"],
        },
        { type: "witness", factId: "road-a397", count: 1, sourceIds: ["road-api"] },
      ],
    },
    {
      id: "chaos-sms-down",
      atMin: 50,
      kind: "chaos",
      label: "SMS provider goes down",
      effects: [
        { type: "set_fact", factId: "sms-provider", value: "caido" },
        { type: "witness", factId: "sms-provider", count: 1, sourceIds: ["comms-monitor"] },
      ],
    },
    {
      id: "camping-growth",
      atMin: 60,
      kind: "scheduled",
      label: "50 more people at the campsite",
      effects: [
        { type: "set_fact", factId: "camping-headcount", value: 170 },
        { type: "witness", factId: "camping-headcount", count: 3, sourceIds: ["citizens-call"] },
      ],
    },
  ],
});
