"use client";

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

type NoteCountBarProps = {
  parts: readonly { value: number; color: string }[];
  maximum: number;
};

const BAR_HEIGHT = 8;

export function NoteCountBar({ parts, maximum }: NoteCountBarProps) {
  const data = [parts.map(({ value }) => value)];

  return (
    <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <ResponsiveContainer width="100%" height={BAR_HEIGHT}>
        <BarChart
          accessibilityLayer={false}
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <XAxis type="number" domain={[0, maximum]} hide />
          <YAxis type="category" hide />
          {parts.map(({ color }, index) => (
            <Bar
              key={color}
              dataKey={index}
              stackId="notes"
              fill={color}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
