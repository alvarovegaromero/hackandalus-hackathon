"use client";

// shadcn/ui chart primitives (new-york-v4) trimmed to what the dashboard uses:
// no legend (series are labelled directly) and a single dark theme.
import * as React from "react";
import * as RechartsPrimitive from "recharts";
import type { TooltipContentProps } from "recharts";
import { cn } from "@/lib/utils";

export type ChartConfig = Record<
  string,
  { label?: React.ReactNode; icon?: React.ComponentType; color?: string }
>;

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used within a <ChartContainer />");
  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex justify-center text-meta [&_.recharts-cartesian-axis-tick_text]:fill-muted [&_.recharts-cartesian-grid_line]:stroke-grid [&_.recharts-layer]:outline-hidden [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-grid [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={{ width: 320, height: 64 }}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

/** Exposes each series color as --color-<key>, scoped to one chart. */
function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colors = Object.entries(config).filter(([, item]) => item.color);
  if (!colors.length) return null;
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] {\n${colors
          .map(([key, item]) => `  --color-${key}: ${item.color};`)
          .join("\n")}\n}`,
      }}
    />
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  hideZero = false,
}: Partial<TooltipContentProps<number, string>> & {
  className?: string;
  indicator?: "dot" | "line";
  hideLabel?: boolean;
  hideIndicator?: boolean;
  /** Skip series whose value is 0, so stacked tooltips list only what is present. */
  hideZero?: boolean;
}) {
  const { config } = useChart();
  const items = (payload ?? []).filter((item) => !hideZero || item.value !== 0);
  if (!active || !items.length) return null;
  return (
    <div
      className={cn(
        "grid min-w-32 gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-meta text-ink",
        className,
      )}
    >
      {!hideLabel && (
        <div className="font-medium">
          {labelFormatter ? labelFormatter(label, payload ?? []) : label}
        </div>
      )}
      {items.map((item, index) => {
        const key = String(item.dataKey ?? item.name ?? "value");
        const itemConfig = config[key];
        return (
          <div key={key} className="flex items-center gap-2">
            {!hideIndicator && (
              <span
                aria-hidden="true"
                className={cn(
                  "shrink-0 bg-(--color-bg)",
                  indicator === "dot" ? "size-2 rounded-[2px]" : "h-2.5 w-1",
                )}
                style={{ "--color-bg": item.color } as React.CSSProperties}
              />
            )}
            <span className="flex-1 text-muted">{itemConfig?.label ?? item.name}</span>
            <span className="tabular-nums">
              {formatter
                ? formatter(item.value as number, String(item.name), item, index, payload ?? [])
                : item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export { ChartContainer, ChartStyle, ChartTooltip, ChartTooltipContent };
