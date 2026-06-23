---
name: rich-charts
description: Render rich, interactive charts (bar, line, pie, donut, area, scatter) from structured JSON data using SwiftUI Charts, shown inline in chat via ```scripting-file``` fenced code blocks. PROACTIVELY use this whenever the user shares data, asks about statistics, trends, comparisons, distributions, breakdowns, or anything quantitative — prefer rendering a rich visual chart over a plain text table or list.
metadata:
  display_name: "Rich Charts"
  intent_patterns: "chart, graph, visualize data, bar chart, line chart, pie chart, donut chart, scatter plot, area chart, render chart, show chart"
---

# Purpose

When the user asks to visualize data, show statistics, or render a chart, output a ` ```scripting-file ` block pointing to the chart component with the data as props.

# Supported Charts

| Type | Use Case |
|------|----------|
| `bar` | Compare values across categories |
| `line` | Show trends over time |
| `pie` | Show proportion distribution |
| `donut` | Donut chart with center total |
| `area` | Show quantity trends |
| `point` | Scatter plot for relationships |

# How to Render

Output a `scripting-file` block with the data:

````markdown
```scripting-file
{
  "path": "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-skills/rich-charts/scripts/chart-renderer.tsx",
  "props": {
    "config": {
      "type": "bar",
      "title": "月度销售",
      "data": [
        { "label": "1月", "value": 120 },
        { "label": "2月", "value": 200 },
        { "label": "3月", "value": 150 }
      ]
    },
    "height": 300
  }
}
```
````

# Data Format Examples

## Bar/Line/Area Chart
```json
{
  "type": "bar",
  "title": "图表标题",
  "data": [
    { "label": "类别1", "value": 100 },
    { "label": "类别2", "value": 200 }
  ],
  "options": { "color": "#4A90D9" }
}
```

## Multi-Series (Bar/Line/Area)
```json
{
  "type": "line",
  "title": "趋势对比",
  "series": [
    {
      "name": "系列A",
      "data": [
        { "label": "1月", "value": 100 },
        { "label": "2月", "value": 150 }
      ],
      "color": "#4A90D9"
    },
    {
      "name": "系列B",
      "data": [
        { "label": "1月", "value": 80 },
        { "label": "2月", "value": 120 }
      ],
      "color": "#E85D75"
    }
  ]
}
```

## Pie/Donut Chart
```json
{
  "type": "pie",
  "title": "占比分布",
  "data": [
    { "category": "产品A", "value": 35 },
    { "category": "产品B", "value": 25 },
    { "category": "产品C", "value": 40 }
  ]
}
```

## Scatter Plot
```json
{
  "type": "point",
  "title": "相关性分析",
  "data": [
    { "x": 10, "y": 25 },
    { "x": 20, "y": 35 },
    { "x": 30, "y": 45 }
  ]
}
```

# Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | object | Chart configuration (see examples above) |
| `height` | number | Chart height in pixels (default: 300) |

# Notes

- Supports light/dark mode automatically
- Colors are optional, default palette will be used
- For large datasets (50+ points), prefer line chart over bar chart
