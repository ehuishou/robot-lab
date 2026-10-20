# RuntimeParams 系统使用指南

## 概述

`RuntimeParams` 是 M2 阶段引入的核心系统，它将模块配置（`modules.ts`）转换为实际的游戏玩法数值。

## 设计原则

1. **单次计算，缓存使用** - 进入场景时计算一次，避免每帧重复计算
2. **质量变化时重算** - 拾取/卸货改变质量时重新计算
3. **统一公式** - `MissionExecutor` 复用同一套公式，保证结果一致

## 参数映射关系

### 动力系统
- **电机功率（power）** → 加速度
- **电机效率（efficiency）** → 能源消耗率（效率越高越省电）
- **底盘地形系数** → 不同地形下的速度和加速度
- **总质量** → 影响加速度和能耗（越重越慢，越费电）

### 感知系统
- **传感器感知值（perception）** → 道具拾取半径
- **传感器范围（range）** → 障碍物显形距离
- **传感器精度（accuracy）** → 预警距离和延迟

### 稳定性系统
- **底盘稳定性（stability）** → 可控速度上限
- **底盘稳定性** → 碰撞伤害倍率（稳定性越高，伤害越低）
- **底盘稳定性** → 翻车阈值角度

### 负载与工具
- **工具负载能力（payload）** → 可承载货物重量上限
- **工具类型** → 工具能力（transport/clear/grab）

## 使用示例

```typescript
// 进入场景时构建
const params = buildRuntimeParams(robotConfig, mission, cargoWeight);

// 使用参数
const { accel, maxSpeed, pickupRadius, toolCapability } = params;

// 质量变化时重新计算
this.cargoWeight += cargo.weight;
this.params = buildRuntimeParams(this.robotConfig, this.mission, this.cargoWeight);
```

## 已修复的 Bug

- **Bug 2.1** ✅ 传感器参数现在影响拾取半径和障碍物检测
- **Bug 2.2** ✅ 稳定性现在影响碰撞和控制性能
- **Bug 2.3** ✅ 负载能力现在限制货物搬运
- **Bug 2.4** ✅ 工具类型现在有明确的能力差异
- **Bug 2.5** ✅ 电机效率现在影响能源消耗
- **Bug 2.6** ✅ 避免每帧多次计算 stats

## 下一步（M3）

需要实现障碍物系统和固定关卡布局，才能真正体现感知、稳定性和工具的差异。
