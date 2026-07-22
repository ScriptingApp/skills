import {
  type Color,
  type KeywordPoint,
  Rectangle,
  Text,
  VStack,
  ZStack,
} from "scripting"

export type GradientBackgroundConfig = {
  lightColors: Color[]
  darkColors: Color[]
  startPoint: KeywordPoint
  endPoint: KeywordPoint
}

export const defaultGradientConfig: GradientBackgroundConfig = {
  lightColors: ["#F3FAFF", "#9EDFE3", "#4C8ED9"],
  darkColors: ["#08131F", "#155A66", "#263F79"],
  startPoint: "topLeading",
  endPoint: "bottomTrailing",
}

export function CustomGradientBackground({
  config = defaultGradientConfig,
}: {
  config?: GradientBackgroundConfig
}) {
  return (
    <Rectangle
      fill={{
        light: {
          colors: config.lightColors,
          startPoint: config.startPoint,
          endPoint: config.endPoint,
        },
        dark: {
          colors: config.darkColors,
          startPoint: config.startPoint,
          endPoint: config.endPoint,
        },
      }}
      ignoresSafeArea={true}
      allowsHitTesting={false}
    />
  )
}

export default function GradientBackgroundExample() {
  return (
    <ZStack>
      <CustomGradientBackground />
      <VStack spacing={8} padding={24}>
        <Text font="title2" fontWeight="bold">
          自定义渐变背景
        </Text>
        <Text>页面内容放在背景之后。</Text>
      </VStack>
    </ZStack>
  )
}
