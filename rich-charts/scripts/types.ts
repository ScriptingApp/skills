/**
 * Rich Charts - 数据结构定义
 * 用于 LLM 输出图表数据的统一格式
 */

// ==================== 基础类型 ====================

/** 颜色值（支持 CSS 颜色字符串） */
export type ChartColor = string;

/** 单个数据点 */
export interface DataPoint {
  label: string | Date;
  value: number;
  unit?: CalendarComponent;
}

/** 分类数据点（用于饼图/环形图） */
export interface CategoryDataPoint {
  category: string;
  value: number;
}

/** 散点图数据点 */
export interface ScatterPoint {
  x: number;
  y: number;
}

/** 多系列数据 */
export interface SeriesData {
  name: string;
  data: DataPoint[];
  color?: ChartColor;
}

// ==================== 图表类型 ====================

export type ChartType = 'bar' | 'bar1d' | 'line' | 'area' | 'areaStack' | 'pie' | 'donut' | 'point';

// ==================== 图表配置 ====================

/** 柱状图配置 */
export interface BarChartConfig {
  type: 'bar';
  title?: string;
  /** 单系列数据 */
  data?: DataPoint[];
  /** 多系列数据 */
  series?: SeriesData[];
  options?: {
    /** 横向显示（标签在 Y 轴） */
    labelOnYAxis?: boolean;
    /** 默认颜色 */
    color?: ChartColor;
    /** 圆角 */
    cornerRadius?: number;
  };
}

/** 一维柱状图配置 */
export interface Bar1DChartConfig {
  type: 'bar1d';
  title?: string;
  data: CategoryDataPoint[];
  options?: {
    /** 横向显示 */
    labelOnYAxis?: boolean;
    /** 颜色列表 */
    colors?: ChartColor[];
  };
}

/** 折线图配置 */
export interface LineChartConfig {
  type: 'line';
  title?: string;
  /** 单系列数据 */
  data?: DataPoint[];
  /** 多系列数据 */
  series?: SeriesData[];
  options?: {
    /** 横向显示 */
    labelOnYAxis?: boolean;
    /** 曲线插值方法 */
    interpolationMethod?: 'linear' | 'catmullRom' | 'cardinal' | 'monotone' | 'stepCenter' | 'stepEnd' | 'stepStart';
    /** 显示数据点 */
    showSymbols?: boolean;
    /** 符号类型 */
    symbol?: 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'plus' | 'pentagon' | 'asterisk';
  };
}

/** 面积图配置 */
export interface AreaChartConfig {
  type: 'area';
  title?: string;
  /** 单系列数据 */
  data?: DataPoint[];
  /** 多系列数据 */
  series?: SeriesData[];
  options?: {
    /** 横向显示 */
    labelOnYAxis?: boolean;
    /** 曲线插值方法 */
    interpolationMethod?: 'linear' | 'catmullRom' | 'cardinal' | 'monotone' | 'stepCenter' | 'stepEnd' | 'stepStart';
  };
}

/** 堆叠面积图配置 */
export interface AreaStackChartConfig {
  type: 'areaStack';
  title?: string;
  data: Array<{
    category: string;
    label: string | Date;
    value: number;
    unit?: CalendarComponent;
  }>;
  options?: {
    /** 横向显示 */
    labelOnYAxis?: boolean;
    /** 堆叠方式 */
    stacking?: 'standard' | 'normalized' | 'center' | 'unstacked';
    /** 颜色列表 */
    colors?: ChartColor[];
  };
}

/** 饼图配置 */
export interface PieChartConfig {
  type: 'pie';
  title?: string;
  data: CategoryDataPoint[];
  options?: {
    /** 显示百分比 */
    showPercentage?: boolean;
    /** 颜色列表 */
    colors?: ChartColor[];
  };
}

/** 环形图配置 */
export interface DonutChartConfig {
  type: 'donut';
  title?: string;
  data: CategoryDataPoint[];
  options?: {
    /** 显示百分比 */
    showPercentage?: boolean;
    /** 颜色列表 */
    colors?: ChartColor[];
    /** 内半径比例（0-1） */
    innerRadius?: number;
    /** 外半径比例（0-1） */
    outerRadius?: number;
  };
}

/** 散点图配置 */
export interface PointChartConfig {
  type: 'point';
  title?: string;
  /** 单系列数据 */
  data?: ScatterPoint[];
  /** 多系列数据 */
  series?: Array<{
    name: string;
    data: ScatterPoint[];
    color?: ChartColor;
  }>;
  options?: {
    /** 点大小 */
    symbolSize?: number;
    /** 符号类型 */
    symbol?: 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'plus' | 'pentagon' | 'asterisk';
  };
}

// ==================== 联合类型 ====================

/** 图表配置联合类型 */
export type ChartConfig =
  | BarChartConfig
  | Bar1DChartConfig
  | LineChartConfig
  | AreaChartConfig
  | AreaStackChartConfig
  | PieChartConfig
  | DonutChartConfig
  | PointChartConfig;

// ==================== 渲染组件 Props ====================

/** ChartRenderer Props */
export interface ChartRendererProps {
  config: ChartConfig;
  /** 图表高度（默认 300） */
  height?: number;
}

/** 各子组件 Props */
export interface BaseChartProps {
  title?: string;
  height: number;
}

export interface BarChartProps extends BaseChartProps {
  data?: DataPoint[];
  series?: SeriesData[];
  labelOnYAxis?: boolean;
  color?: ChartColor;
  cornerRadius?: number;
}

export interface Bar1DChartProps extends BaseChartProps {
  data: CategoryDataPoint[];
  labelOnYAxis?: boolean;
  colors?: ChartColor[];
}

export interface LineChartProps extends BaseChartProps {
  data?: DataPoint[];
  series?: SeriesData[];
  labelOnYAxis?: boolean;
  interpolationMethod?: string;
  showSymbols?: boolean;
  symbol?: string;
}

export interface AreaChartProps extends BaseChartProps {
  data?: DataPoint[];
  series?: SeriesData[];
  labelOnYAxis?: boolean;
  interpolationMethod?: string;
}

export interface AreaStackChartProps extends BaseChartProps {
  data: Array<{
    category: string;
    label: string | Date;
    value: number;
    unit?: CalendarComponent;
  }>;
  labelOnYAxis?: boolean;
  stacking?: string;
  colors?: ChartColor[];
}

export interface PieChartProps extends BaseChartProps {
  data: CategoryDataPoint[];
  showPercentage?: boolean;
  colors?: ChartColor[];
}

export interface DonutChartProps extends BaseChartProps {
  data: CategoryDataPoint[];
  showPercentage?: boolean;
  colors?: ChartColor[];
  innerRadius?: number;
  outerRadius?: number;
}

export interface PointChartProps extends BaseChartProps {
  data?: ScatterPoint[];
  series?: Array<{
    name: string;
    data: ScatterPoint[];
    color?: ChartColor;
  }>;
  symbolSize?: number;
  symbol?: string;
}

// ==================== 工具类型 ====================

/** CalendarComponent（用于时间序列） */
export type CalendarComponent = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';
