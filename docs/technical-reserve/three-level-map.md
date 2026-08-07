# 技术储备：三级连续星图

## 状态

这套地图不属于第一版玩法验证。第一版只启用银河系大图，并将行星系简化为“有人居住”和“无人居住”两类，不提供向恒星系、行星或卫星层深入的入口。

保留此实现是为了在核心客运经营循环验证通过后，能够重新评估沉浸式地图是否值得进入产品范围；它目前不应产生首版开发、测试、性能或内容制作要求。

## 已完成的技术内容

- 同一视窗中的“银河 → 恒星系 → 行星/卫星”三级语义缩放
- 各层独立缩放区间、阈值锁定、双击深入、面包屑返回和居中动画
- 以指针世界坐标为中心的滚轮缩放，以及带阻尼和回弹的内容边界
- 航道、轨道、标签、星港和交互热区随层级连续显隐
- 1 至 3 颗恒星、4 至 9 颗行星、卫星、星环、殖民地与星港位置的可复现生成
- 行星与卫星的公转、自转、初始相位和自转轴倾角动画
- Three.js WebGPU / WebGL 2 天体渲染与 SVG 最终降级
- 普通行星程序化地表、气态与冰巨星条带材质，以及 O–M 光谱型恒星材质
- 行星和卫星的人口、殖民地、发展度、经济类型、周期、倾角与星环数据面板

## 保留代码

- `src/web/technical-reserve/ContinuousGalaxyMap.tsx`：三级连续视窗原型
- `src/web/technical-reserve/SystemMap.tsx`：独立恒星系层原型
- `src/web/technical-reserve/PlanetMap.tsx`：独立行星与卫星层原型
- `src/web/technical-reserve/CelestialWebGpuLayer.tsx`：WebGPU / WebGL 天体渲染层
- `src/web/technical-reserve/PlanetBody.tsx`、`SpaceBackdrop.tsx`：SVG 天体降级实现
- `src/web/technical-reserve/mapTransitions.ts`：独立分层地图的相机与过渡工具

这些文件不由首版 `App` 入口引用。若未来重新启用，需要先重新确认用户价值，再补做代码拆分、LOD、设备丢失恢复、视觉回归、触控与无障碍验证。
