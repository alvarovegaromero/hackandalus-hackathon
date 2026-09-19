"use client";

import { Bar, BarChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import Skeleton from "@/components/Skeleton";
import Kpi from "./kpi";
import { PRIORITIES, PRIORITY_LABELS, countByPriority, perMinute, type RankedEvent } from "./model";

// Stack order: critical sits on the baseline, where lengths compare best.
const chartConfig = Object.fromEntries(
  PRIORITIES.map((level, index) => [
    level,
    { label: PRIORITY_LABELS[level], color: `var(--chart-${index + 1})` },
  ]),
) satisfies ChartConfig;

const time = (minute: number) =>
  new Date(minute).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export default function SeverityCard({
  events,
  loading,
}: {
  events: RankedEvent[];
  loading: boolean;
}) {
  const counts = countByPriority(events);
  const bins = perMinute(events);
  const rest = counts.medium + counts.low + counts.unassessed;
  return (
    <Card aria-labelledby="severity-title">
      <CardHeader>
        <CardTitle id="severity-title">Active incidents</CardTitle>
        <span className="text-meta text-muted tabular-nums">{events.length} active</span>
      </CardHeader>
      <CardContent className="flex items-end gap-5">
        {loading ? (
          <Skeleton className="h-9 w-40" />
        ) : (
          <>
            <Kpi value={counts.critical} label="Critical" tone="text-critical" />
            <Kpi value={counts.high} label="High" tone="text-high" />
            <Kpi value={rest} label="Other" tone="text-muted" />
          </>
        )}
        {!!bins.length && (
          <figure className="ml-auto w-28 self-stretch">
            <ChartContainer
              config={chartConfig}
              className="h-full min-h-10 w-full"
              role="img"
              aria-label={`Active events by arrival minute and priority, ${bins.length} minutes shown.`}
            >
              <BarChart
                accessibilityLayer
                data={bins}
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                barCategoryGap={1}
              >
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      hideZero
                      labelFormatter={(_, payload) =>
                        payload[0] ? time(payload[0].payload.minute) : ""
                      }
                    />
                  }
                />
                {PRIORITIES.map((level) => (
                  <Bar
                    key={level}
                    dataKey={level}
                    stackId="p"
                    fill={`var(--color-${level})`}
                    radius={0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ChartContainer>
            <figcaption className="sr-only">
              {bins
                .map(
                  (bin) =>
                    `${time(bin.minute)}: ${PRIORITIES.reduce((sum, level) => sum + bin[level], 0)}`,
                )
                .join(", ")}
            </figcaption>
          </figure>
        )}
      </CardContent>
      <CardContent className="mt-auto flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {/* Share of active incidents by priority: the whole picture in one bar. */}
        {PRIORITIES.map((level) =>
          counts[level] ? (
            <span
              key={level}
              className="transition-[flex-grow] duration-500"
              style={{ flexGrow: counts[level], background: `var(--${level})` }}
              title={`${counts[level]} ${PRIORITY_LABELS[level]}`}
            />
          ) : null,
        )}
        {!events.length && <span className="flex-1 bg-line" />}
      </CardContent>
    </Card>
  );
}
