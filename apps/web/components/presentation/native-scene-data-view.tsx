import type { KeyboardEvent } from "react";
import type { NativeChartNode, NativeDataNode } from "../../lib/presentation-native-data";
import styles from "./native-scene-data.module.css";

// Each mark contrasts with paper and midnight; labels and the table also identify series.
export const NATIVE_CHART_COLORS = ["#3676ac", "#2f805f", "#a85f20", "#8a61aa"] as const;
const colorNames = ["blue", "green", "orange", "purple"] as const;
const dashes = [undefined, "9 4", "3 3", "10 3 2 3"] as const;
const coordinate = (value: number) => Number(value.toFixed(3));

function scrollKey(event: KeyboardEvent<HTMLElement>) {
  if (
    [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      " ",
    ].includes(event.key)
  ) {
    // Preserve native scrolling while keeping ancestor slide-navigation shortcuts out.
    event.stopPropagation();
  }
}

function Pie({ node }: { node: NativeChartNode }) {
  const values = node.series[0]!.values;
  const total = values.reduce((sum, value) => sum + value, 0);
  const positiveCount = values.filter((value) => value > 0).length;
  let angle = -Math.PI / 2;
  return (
    <>
      {values.map((value, index) => {
        if (!value) return null;
        const portion = value / total;
        const start = angle;
        const end = angle + portion * Math.PI * 2;
        angle = end;
        const labelAngle = (start + end) / 2;
        const fill = NATIVE_CHART_COLORS[index % NATIVE_CHART_COLORS.length];
        // Split each slice at its midpoint: a near-full turn still paints when rounded
        // start/end coordinates coincide. Only an actual sole positive value is a circle.
        const path = `M320 140 L${coordinate(320 + Math.cos(start) * 112)} ${coordinate(140 + Math.sin(start) * 112)} A112 112 0 0 1 ${coordinate(320 + Math.cos(labelAngle) * 112)} ${coordinate(140 + Math.sin(labelAngle) * 112)} A112 112 0 0 1 ${coordinate(320 + Math.cos(end) * 112)} ${coordinate(140 + Math.sin(end) * 112)} Z`;
        return (
          <g key={index} data-pie-category={index + 1}>
            {positiveCount === 1 ? (
              <circle cx="320" cy="140" r="112" fill={fill} />
            ) : (
              <path d={path} fill={fill} stroke="var(--native-background, #fff)" strokeWidth="2" />
            )}
            {portion >= 0.035 ? (
              <text
                x={coordinate(320 + Math.cos(labelAngle) * 78)}
                y={coordinate(144 + Math.sin(labelAngle) * 78)}
                textAnchor="middle"
                fill="#fff"
                fontSize="14"
                fontWeight="700"
              >
                {index + 1}
              </text>
            ) : null}
          </g>
        );
      })}
    </>
  );
}

function Cartesian({ node }: { node: NativeChartNode }) {
  const values = node.series.flatMap((series) => series.values);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values) || (minimum === 0 ? 1 : 0);
  const range = maximum - minimum;
  const y = (value: number) => coordinate(20 + ((maximum - value) / range) * 210);
  const groupWidth = 560 / node.categories.length;
  const x = (index: number) => coordinate(60 + groupWidth * (index + 0.5));
  const baseline = y(0);
  return (
    <>
      {Array.from({ length: 5 }, (_, index) => {
        const value = minimum + (range * index) / 4;
        return (
          <g key={index}>
            <line
              x1="60"
              x2="620"
              y1={y(value)}
              y2={y(value)}
              stroke="currentColor"
              strokeOpacity="0.2"
            />
            <text x="53" y={y(value) + 4} textAnchor="end" fill="currentColor" fontSize="11">
              {Number(value.toPrecision(3))}
            </text>
          </g>
        );
      })}
      <line x1="60" x2="620" y1={baseline} y2={baseline} stroke="currentColor" />
      {node.categories.map((_, index) => (
        <text
          key={index}
          x={x(index)}
          y="253"
          fill="currentColor"
          textAnchor="middle"
          fontSize="12"
        >
          {index + 1}
        </text>
      ))}
      {node.series.map((series, seriesIndex) => {
        const color = NATIVE_CHART_COLORS[seriesIndex]!;
        return (
          <g key={seriesIndex} data-chart-series={seriesIndex + 1}>
            {node.chartType === "bar" ? (
              series.values.map((value, index) => {
                const width = (groupWidth * 0.78) / node.series.length;
                return (
                  <rect
                    key={index}
                    x={coordinate(x(index) - groupWidth * 0.39 + width * seriesIndex)}
                    y={Math.min(y(value), baseline)}
                    width={coordinate(Math.max(0.1, width - 1))}
                    height={Math.abs(y(value) - baseline)}
                    fill={color}
                  />
                );
              })
            ) : (
              <>
                <path
                  d={series.values
                    .map((value, index) => `${index === 0 ? "M" : "L"}${x(index)} ${y(value)}`)
                    .join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth="3"
                  strokeDasharray={dashes[seriesIndex]}
                />
                {series.values.map((value, index) => (
                  <circle
                    key={index}
                    cx={x(index)}
                    cy={y(value)}
                    r={seriesIndex + 3}
                    fill={color}
                  />
                ))}
              </>
            )}
          </g>
        );
      })}
    </>
  );
}

/** The same closed local data view is used by editor, preview and participant surfaces. */
export function NativeSceneDataView({
  node,
  fixedLayout = false,
}: {
  node: NativeDataNode;
  fixedLayout?: boolean;
}) {
  if (node.type === "table")
    return (
      <div
        className={styles.dataView}
        data-native-data="table"
        data-native-fixed-layout={fixedLayout ? "true" : undefined}
        role="group"
        aria-label={node.caption.trim() || "Data table"}
        tabIndex={0}
        onKeyDown={scrollKey}
      >
        <table className={styles.dataTable}>
          <caption>{node.caption}</caption>
          <thead>
            <tr>
              {node.headers.map((header, index) => (
                <th key={index} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.rows.map((row, index) => (
              <tr key={index}>
                {row.map((value, column) => (
                  <td key={column} data-label={node.headers[column]}>
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  const legend =
    node.chartType === "pie" ? node.categories : node.series.map((series) => series.name);
  // Preserve the 1280px authored-plane layout as the same slide is scaled for editing.
  const chartLayout = (node.frame.width / 100) * 1280 >= 600 ? "split" : "stack";
  return (
    <figure
      className={`${styles.dataView} ${styles.chart}`}
      data-native-data="chart"
      data-native-fixed-layout={fixedLayout ? "true" : undefined}
      data-chart-layout={chartLayout}
      data-chart-type={node.chartType}
      aria-label={node.title.trim() || "Chart"}
      tabIndex={0}
      onKeyDown={scrollKey}
    >
      <figcaption>
        <strong>{node.title}</strong>
        <div>{node.summary}</div>
      </figcaption>
      <div className={styles.chartColumns}>
        <div className={styles.chartVisual}>
          <svg className={styles.plot} viewBox="0 0 640 270" aria-hidden="true" focusable="false">
            {node.chartType === "pie" ? <Pie node={node} /> : <Cartesian node={node} />}
          </svg>
          <ul className={styles.legend} aria-label="Chart legend">
            {legend.map((name, index) => (
              <li key={index}>
                <span
                  className={styles.swatch}
                  style={{ background: NATIVE_CHART_COLORS[index % NATIVE_CHART_COLORS.length] }}
                  aria-hidden="true"
                />
                {index + 1}. {name} · {colorNames[index % colorNames.length]}
              </li>
            ))}
          </ul>
          <div className={styles.categoryHelp}>Category numbers match the data table.</div>
        </div>
        <table className={styles.dataTable}>
          <caption>{node.title} · chart data</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              {node.series.map((series, index) => (
                <th key={index} scope="col">
                  {series.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {node.categories.map((category, index) => (
              <tr key={index}>
                <th scope="row">
                  {index + 1}. {category}
                </th>
                {node.series.map((series, seriesIndex) => (
                  <td key={seriesIndex} data-label={series.name}>
                    {String(series.values[index])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
