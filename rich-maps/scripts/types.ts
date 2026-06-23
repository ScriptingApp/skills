/**
 * Rich Maps - 数据结构定义
 * 用于 LLM 输出地图数据的统一格式
 */

import { Color } from "scripting"

// ==================== 基础类型 ====================

/** 坐标 */
export interface MapCoordinate {
  latitude: number;
  longitude: number;
}

/** 地图区域跨度 */
export interface MapSpan {
  latitudeDelta: number;
  longitudeDelta: number;
}

/** 地图区域 */
export interface MapRegion {
  center: MapCoordinate;
  span: MapSpan;
}

/** 地点信息 */
export interface MapLocation {
  name: string;
  coordinate: MapCoordinate;
  subtitle?: string;
}

// ==================== 地图类型 ====================

export type MapType =
  | 'navigation'
  | 'traffic'
  | 'nearby'
  | 'markers'
  | 'area'
  | 'itinerary'
  | 'route-compare'
  | 'explore'
  | 'trip';

// ==================== 标记点 ====================

/** 标记点配置 */
export interface MapMarker {
  coordinate: MapCoordinate;
  title: string;
  subtitle?: string;
  color?: string;
  /** SF Symbol 名称 */
  systemImage?: string;
}

// ==================== 地图配置 ====================

/** 导航地图配置 */
export interface NavigationMapConfig {
  type: 'navigation';
  source: MapLocation;
  destination: MapLocation;
  /** 交通方式 */
  transportType?: 'automobile' | 'walking' | 'transit';
  /** 显示转向步骤 */
  showSteps?: boolean;
  /** 地图高度 */
  height?: number;
}

/** 路况地图配置 */
export interface TrafficMapConfig {
  type: 'traffic';
  center: MapCoordinate;
  span?: MapSpan;
  /** 显示交通状况 */
  showTraffic?: boolean;
  /** 标记点 */
  markers?: MapMarker[];
  /** 地图高度 */
  height?: number;
}

/** 周边搜索配置 */
export interface NearbyMapConfig {
  type: 'nearby';
  center: MapCoordinate;
  /** 搜索半径（米） */
  radius?: number;
  /** 搜索关键词 */
  keyword?: string;
  /** POI 类别 */
  category?: string;
  /** 显示结果信息 */
  showInfo?: boolean;
  /** 地图高度 */
  height?: number;
}

/** 多点标注配置 */
export interface MarkersMapConfig {
  type: 'markers';
  region: MapRegion;
  markers: MapMarker[];
  /** 地图高度 */
  height?: number;
}

/** 区域展示配置 */
export interface AreaMapConfig {
  type: 'area';
  center: MapCoordinate;
  /** 圆形半径（米） */
  radius?: number;
  /** 填充颜色 */
  fillColor?: string;
  /** 边框颜色 */
  strokeColor?: string;
  /** 标记点 */
  markers?: MapMarker[];
  /** 地图高度 */
  height?: number;
}

// ==================== 行程规划 (itinerary) ====================

/** 行程中的一个停靠点 */
export interface ItineraryStop {
  time: string;
  name: string;
  coordinate: MapCoordinate;
  /** 停留时长，如 "2小时" */
  duration?: string;
  note?: string;
}

/** 行程中的一天 */
export interface ItineraryDay {
  /** 日期标题，如 "Day 1 · 市区" */
  date: string;
  stops: ItineraryStop[];
}

/** 行程规划地图配置 */
export interface ItineraryMapConfig {
  type: 'itinerary';
  title?: string;
  days: ItineraryDay[];
  /** 地图高度 */
  height?: number;
}

// ==================== 路线对比 (route-compare) ====================

/** 一条可对比的路线方案 */
export interface CompareRoute {
  /** 交通方式标识，如 driving / transit / walking / cycling */
  mode: string;
  /** 显示图标 emoji，如 "🚗" */
  icon?: string;
  /** 方案名称，如 "打车" */
  name: string;
  /** 预计耗时，如 "18分钟" */
  duration?: string;
  /** 距离，如 "6.2公里" */
  distance?: string;
  /** 费用，如 "¥25" */
  cost?: string;
  /** 路线颜色，默认 systemBlue */
  color?: Color;
  /** 可选的路线坐标点；缺失则在 source→destination 间画直线 */
  coordinates?: MapCoordinate[];
}

/** 路线对比地图配置 */
export interface RouteCompareMapConfig {
  type: 'route-compare';
  source: MapLocation;
  destination: MapLocation;
  routes: CompareRoute[];
  /** 地图高度 */
  height?: number;
}

// ==================== 交互式探索 (explore) ====================

/** 探索地图中的一个地点 */
export interface ExplorePlace {
  name: string;
  coordinate: MapCoordinate;
  /** 分类，如 "景点" / "餐厅" */
  category?: string;
  /** 评分 0-5 */
  rating?: number;
  /** 地址 */
  address?: string;
  /** 标记颜色，默认 systemRed */
  color?: Color;
}

/** 交互式探索地图配置 */
export interface ExploreMapConfig {
  type: 'explore';
  center: MapCoordinate;
  span?: MapSpan;
  /** 搜索关键词，用于标题展示 */
  keyword?: string;
  places: ExplorePlace[];
  /** 地图高度 */
  height?: number;
}

// ==================== 旅行助手聚合 (trip) ====================

/** trip 可切换的子页 tab 标识 */
export type TripTab = 'explore' | 'itinerary' | 'compare';

/** explore 块数据（不带 type） */
export interface TripExploreData {
  center: MapCoordinate;
  span?: MapSpan;
  keyword?: string;
  places: ExplorePlace[];
}

/** itinerary 块数据（不带 type） */
export interface TripItineraryData {
  title?: string;
  days: ItineraryDay[];
}

/** route-compare 块数据（不带 type） */
export interface TripRouteCompareData {
  source: MapLocation;
  destination: MapLocation;
  routes: CompareRoute[];
}

/** 旅行助手聚合地图配置 */
export interface TripMapConfig {
  type: 'trip';
  title?: string;
  /** 副标题；缺省根据数据自动生成汇总 */
  subtitle?: string;
  /** 限定/排序显示哪些 tab；缺省按提供的数据推导 */
  tabs?: TripTab[];
  explore?: TripExploreData;
  itinerary?: TripItineraryData;
  routeCompare?: TripRouteCompareData;
  /** 地图高度 */
  height?: number;
}

// ==================== 联合类型 ====================

/** 地图配置联合类型 */
export type MapConfig =
  | NavigationMapConfig
  | TrafficMapConfig
  | NearbyMapConfig
  | MarkersMapConfig
  | AreaMapConfig
  | ItineraryMapConfig
  | RouteCompareMapConfig
  | ExploreMapConfig
  | TripMapConfig;

// ==================== 渲染组件 Props ====================

/** MapRenderer Props */
export interface MapRendererProps {
  config: MapConfig;
}

/** 各子组件 Props */
export interface BaseMapProps {
  height: number;
}

export interface NavigationMapProps extends BaseMapProps {
  source: MapLocation;
  destination: MapLocation;
  transportType?: string;
  showSteps?: boolean;
}

export interface TrafficMapProps extends BaseMapProps {
  center: MapCoordinate;
  span?: MapSpan;
  showTraffic?: boolean;
  markers?: MapMarker[];
}

export interface NearbyMapProps extends BaseMapProps {
  center: MapCoordinate;
  radius?: number;
  keyword?: string;
  category?: string;
  showInfo?: boolean;
}

export interface MarkersMapProps extends BaseMapProps {
  region: MapRegion;
  markers: MapMarker[];
}

export interface AreaMapProps extends BaseMapProps {
  center: MapCoordinate;
  radius?: number;
  fillColor?: string;
  strokeColor?: string;
  markers?: MapMarker[];
}

export interface ItineraryMapProps extends BaseMapProps {
  title?: string;
  days: ItineraryDay[];
}

export interface RouteCompareMapProps extends BaseMapProps {
  source: MapLocation;
  destination: MapLocation;
  routes: CompareRoute[];
}

export interface ExploreMapProps extends BaseMapProps {
  center: MapCoordinate;
  span?: MapSpan;
  keyword?: string;
  places: ExplorePlace[];
}

export interface TripMapProps extends BaseMapProps {
  title?: string;
  subtitle?: string;
  tabs?: TripTab[];
  explore?: TripExploreData;
  itinerary?: TripItineraryData;
  routeCompare?: TripRouteCompareData;
}
