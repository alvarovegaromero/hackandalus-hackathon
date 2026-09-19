"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import Skeleton from "@/components/Skeleton";
import { cn } from "@/lib/utils";
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
  const recent = bins.slice(-5).reduce((sum, bin) => sum + total(bin), 0);
  const before = bins.slice(-10, -5).reduce((sum, bin) => sum + total(bin), 0);
  return (
    <Card aria-labelledby="severity-title">
      <CardHeader>
        <CardTitle id="severity-title">What is most severe now?</CardTitle>
        <span className="text-meta text-muted">{events.length} active</span>
      </CardHeader>
      <CardContent className="flex items-end gap-6">
        {loading ? (
          <Skeleton className="h-9 w-40" />
        ) : (
          <>
            <Kpi value={counts.critical} label="Critical" tone="text-critical" />
            <Kpi value={counts.high} label="High" tone="text-high" />
            <p className="pb-1 text-meta text-muted tabular-nums">
              {counts.medium} medium · {counts.low} low · {counts.unassessed} unassessed
            </p>
          </>
        )}
      </CardContent>
      <CardContent>
        {bins.length ? (
          <figure>
            <ChartContainer
              config={chartConfig}
              className="h-18 w-full"
              role="img"
              aria-label={`Active events by arrival minute and priority, ${bins.length} minutes shown.`}
            >
              <BarChart
                accessibilityLayer
                data={bins}
                margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                barCategoryGap={1}
              >
                <CartesianGrid vertical={false} strokeDasharray="2 3" />
                <XAxis
                  dataKey="minute"
                  tickFormatter={time}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  minTickGap={48}
                  height={20}
                />
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
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ChartContainer>
            <figcaption className="sr-only">
              {bins.map((bin) => `${time(bin.minute)}: ${total(bin)}`).join(", ")}
            </figcaption>
          </figure>
        ) : (
          <p className="text-meta text-muted">No reports received since this page loaded.</p>
        )}
      </CardContent>
      <CardFooter className="flex justify-between gap-3">
        <span>Arrivals per minute · since page load</span>
        {bins.length > 5 && (
          <span className="tabular-nums">
            Last 5 min <span className="text-ink">{recent}</span> · previous {before}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}

function total(bin: Record<string, number>) {
  return PRIORITIES.reduce((sum, level) => sum + bin[level], 0);
}

function Kpi({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div>
      <p
        className={cn(
          "text-kpi leading-none font-semibold tabular-nums",
          value ? tone : "text-muted",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-meta text-muted">{label}</p>
    </div>
  );
}
