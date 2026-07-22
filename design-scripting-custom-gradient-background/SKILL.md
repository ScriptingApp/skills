---
name: design-scripting-custom-gradient-background
description: 为任意 Scripting 脚本添加简洁、可复用的自定义渐变背景，覆盖浅深色配色、渐变方向、根层挂载、持久化与可读性检查。
metadata:
  display_name: "Scripting Custom Gradient Background"
  intent_patterns: "自定义渐变背景, Scripting 渐变背景, 页面背景配色, 动态渐变主题, 浅深色渐变"
  required_tools: "file_tool, get_typescript_diagnostics"
---

# Purpose

为任意 Scripting 脚本增加纯粹的自定义渐变背景。此 Skill 只负责背景颜色、渐变方向、浅深色方案和挂载方式，不扩展到其他视觉表面或业务改造。

## When to use

- 页面需要两色或多色渐变背景；
- 同一背景需要适配浅色与深色模式；
- 用户需要保存自定义渐变端点；
- 多页面项目需要统一复用一个背景组件。

## Core rules

1. 每个页面根层只挂载一个背景组件。
2. 背景使用 `Rectangle` 填满画面，并设置 `ignoresSafeArea={true}`。
3. 背景必须设置 `allowsHitTesting={false}`，避免阻挡按钮、列表和手势。
4. 浅色与深色模式分别配置颜色，不直接复用同一组高亮颜色。
5. 默认采用 2–3 个颜色节点；节点过多会降低内容辨识度。
6. 渐变方向优先使用 `topLeading → bottomTrailing`；仅在构图需要时调整。
7. 背景组件只接收配置，不读取或改写页面业务状态。
8. 自定义颜色需要持久化时，使用独立且带版本号的 Storage key。
9. 文字和关键状态不能只依赖背景颜色表达；同时保留文字、图标或形状线索。
10. 内容在渐变最亮与最暗区域都必须可读。

## Minimal workflow

1. 确认脚本真实页面入口和根布局。
2. 定义浅色、深色颜色数组以及起止方向。
3. 创建独立的 `CustomGradientBackground` 组件。
4. 在页面根 `ZStack` 中先放背景，再放内容。
5. 若有滚动容器，确保其默认背景不会遮住根渐变。
6. 检查浅色、深色、长文字、按钮点击和滚动行为。
7. 修改后运行 TypeScript diagnostics。

## Recommended model

```ts
type GradientBackgroundConfig = {
  lightColors: Color[]
  darkColors: Color[]
  startPoint: KeywordPoint
  endPoint: KeywordPoint
}
```

用一个配置对象集中管理颜色与方向，不要把色值散落到各页面。

## Reusable component

读取并复制 `scripts/custom-gradient-background.tsx`。最小挂载方式：

```tsx
<ZStack>
  <CustomGradientBackground config={gradientConfig} />
  <PageContent />
</ZStack>
```

## Optional persistence

如果允许用户编辑两个渐变端点：

- 使用例如 `custom_gradient_start_v1` 与 `custom_gradient_end_v1` 的独立 key；
- 读取后先校验值是否为受支持的颜色格式；
- 无效或缺失值回退到默认颜色；
- 预设方案只保存稳定 ID，自定义端点才保存实际颜色；
- 更新颜色只刷新背景，不重建导航树或业务数据。

## Acceptance checklist

- [ ] 全屏无安全区断层；
- [ ] 背景不拦截点击和滚动；
- [ ] 浅色与深色均有独立配色；
- [ ] 页面只有一个根背景 owner；
- [ ] 主要文字、图标和按钮在各颜色区域清晰可辨；
- [ ] 自定义颜色读取失败时能安全回退；
- [ ] 切换配色不影响导航和业务状态；
- [ ] TypeScript diagnostics 无新增错误。

## Boundaries

不要借此任务修改网络、存储结构、下载、播放器、解析、导航语义或其他业务逻辑。除渐变背景及其必要配置外，不增加任何其他视觉效果。
