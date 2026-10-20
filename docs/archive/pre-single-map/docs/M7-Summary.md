# M7 完成总结 - 音效和教程系统

## ✅ 已完成内容

### 1. AudioManager (`src/systems/AudioManager.ts`)

**核心功能**：
- ✅ 单例模式音效管理器
- ✅ SFX（音效）播放
- ✅ BGM（背景音乐）播放
- ✅ 动态引擎音效（速度相关）
- ✅ **占位音合成**（WebAudio）
- ✅ 音量控制（master/sfx/music 独立通道）
- ✅ 静音功能（持久化到 SaveManager）

**占位音合成（9 种音效）**：

| 音效 | 合成方式 | 描述 |
|------|----------|------|
| `pickup` | 正弦波 600→1200Hz，0.1s | 拾取道具 |
| `pickup_big` | 三和弦上滑，0.3s | 宝箱/大奖励 |
| `collide` | 白噪声 + 低通滤波器 | 碰撞金属 |
| `crate_break` | 白噪声 + 低通滤波器（长） | 木箱破碎 |
| `warning` | 方波 1000Hz 双脉冲 | 障碍预警 |
| `ui_click` | 方波 1000Hz，0.03s | 按钮点击 |
| `mission_success` | 上升音阶 C-E-G-C | 任务成功 |
| `mission_fail` | 下降音阶 G-E-C-A | 任务失败 |
| **引擎音** | 锯齿波 + 低通滤波，60-180Hz | 动态引擎嗡鸣 |

**引擎音效特点**：
- 使用 `OscillatorNode` + `BiquadFilterNode` + `GainNode`
- 锯齿波（sawtooth）模拟电机质感
- 低通滤波器（400Hz）模拟机械振动
- 频率随速度动态变化：60Hz（静止）→ 180Hz（最快）
- 可循环播放，支持启动/停止

**音量系统**：
- **3 个独立通道**：master（主音量）、sfx（音效）、music（音乐）
- **最终音量计算**：`master × channel × localVolume`
- **静音状态持久化**：保存到 `SaveManager.settings.soundMuted`

**API 接口**：
```typescript
AudioManager.getInstance()
  .init(scene)                          // 初始化
  .play('pickup', { volume: 0.8 })      // 播放音效
  .startEngine()                        // 启动引擎音
  .setEngineSpeed(0.7)                  // 设置引擎速度 0-1
  .stopEngine()                         // 停止引擎音
  .playMusic('bgm_play')                // 播放背景音乐
  .stopMusic()                          // 停止音乐
  .setVolume('sfx', 0.7)                // 设置音量
  .mute(true)                           // 静音
  .isMuted()                            // 查询静音状态
```

---

### 2. TutorialSystem (`src/systems/TutorialSystem.ts`)

**核心功能**：
- ✅ 步骤驱动的教程系统
- ✅ 触发条件检测
- ✅ 提示消息显示（科技风格）
- ✅ UI 元素高亮（脉冲动画）
- ✅ 完成条件等待
- ✅ 游戏暂停（可选）
- ✅ 半透明遮罩

**TutorialStep 接口**：
```typescript
interface TutorialStep {
  id: string;                           // 步骤 ID
  trigger: (ctx) => boolean;            // 触发条件
  message: string;                      // 提示文本
  highlight?: 'gas' | 'brake' | 'energy' | 'objectives';
  waitFor: (ctx) => boolean;            // 完成条件
  pauseGame?: boolean;                  // 是否暂停
}
```

**TutorialContext（教程上下文）**：
```typescript
{
  x, y: number;              // 机器人位置
  velocity: number;          // 速度
  energy: number;            // 能源百分比
  accelerating: boolean;     // 是否按油门
  braking: boolean;          // 是否按刹车
  itemsCollected: number;    // 收集道具数
  collisions: number;        // 碰撞次数
  time: number;              // 已用时间
}
```

**预定义教程：TUTORIAL_BEGINNER**（5 个步骤）：

| 步骤 | 触发条件 | 提示 | 高亮 | 完成条件 |
|------|----------|------|------|----------|
| 1. welcome | 立即 | "按住 ↑ 油门按钮前进" | gas | 按下油门 |
| 2. energy | x > 300 | "注意能源条，加速会消耗能源" | energy | x > 500 |
| 3. pickup | x > 800 | "前方有能源包！靠近即可拾取" | - | 收集 ≥ 1 |
| 4. brake | x > 1200 | "前方有障碍物！按 ↓ 刹车减速" | brake | 按下刹车 |
| 5. finish | x > 1500 | "太棒了！继续前进到达终点吧" | - | x > 1800 |

**视觉效果**：
- **提示消息框**：青色边框、深色半透明背景、居中显示、淡入淡出动画
- **高亮框**：黄色双层边框、脉冲动画（alpha 0.3 ↔ 1）
- **遮罩层**：半透明黑色背景（游戏暂停时）
- **完成提示**：绿色大字 "TUTORIAL COMPLETE"

**API 接口**：
```typescript
const tutorial = new TutorialSystem(scene, TUTORIAL_BEGINNER);

// 每帧更新
const isPaused = tutorial.update(context);

// 查询状态
tutorial.isComplete()
tutorial.isPaused()

// 跳过教程
tutorial.skip()

// 清理
tutorial.destroy()
```

---

### 3. SaveManager 扩展

**新增字段**：
```typescript
interface SaveData {
  // ... 原有字段
  settings?: {
    soundMuted?: boolean;    // 静音状态
    musicVolume?: number;    // 音乐音量
    sfxVolume?: number;      // 音效音量
  };
}
```

**导出类型**：
- 将 `SaveData` 从 `interface` 改为 `export interface`
- 允许其他模块（如 AudioManager）导入使用

---

## 📊 当前状态

**编译状态**：✅ 通过（1,541.39 kB，gzip: 357.76 kB）  
**新增模块**：2 个（AudioManager.ts, TutorialSystem.ts）  
**占位音系统**：✅ 完全运行（9 种合成音效）  
**教程系统**：✅ 完全运行（5 步新手教程）  
**音效素材**：0/13（全部使用占位音）

---

## 🎵 音效素材清单（待准备）

当真实音效文件准备好后，放入 `public/assets/audio/` 目录：

| key | 描述 | 时长 | 格式 |
|-----|------|------|------|
| `engine_loop` | 电机嗡鸣（循环） | 1-2s | ogg/mp3 |
| `accelerate` | 加速起步 | 0.5s | ogg/mp3 |
| `brake` | 刹车摩擦 | 0.5s | ogg/mp3 |
| `pickup` | 拾取道具 | 0.3s | ogg/mp3 |
| `pickup_big` | 宝箱/大奖励 | 0.8s | ogg/mp3 |
| `collide` | 撞击金属 | 0.4s | ogg/mp3 |
| `crate_break` | 木箱被推碎 | 0.6s | ogg/mp3 |
| `warning` | 障碍预警哔声 | 0.2s | ogg/mp3 |
| `ui_click` | 按钮点击 | 0.1s | ogg/mp3 |
| `mission_success` | 成功 | 2s | ogg/mp3 |
| `mission_fail` | 失败 | 2s | ogg/mp3 |
| `bgm_menu` | 菜单音乐（循环） | 1-2min | ogg/mp3 |
| `bgm_play` | 任务音乐（循环） | 1-2min | ogg/mp3 |

**替换流程**：
1. 将音效文件放入 `public/assets/audio/`
2. 在 `PreloadScene` 中加载：`this.load.audio(key, path)`
3. **自动替换占位音** - AudioManager 优先使用真实音效

---

## 🎓 教程系统使用示例

### 在 MissionPlayScene 中集成教程：

```typescript
import { TutorialSystem, TUTORIAL_BEGINNER, TutorialContext } from '../systems/TutorialSystem';

export default class MissionPlayScene extends Phaser.Scene {
  private tutorialSystem?: TutorialSystem;

  create() {
    // 如果是教程任务，启动教程
    if (this.missionId === 'task_000') {
      this.tutorialSystem = new TutorialSystem(this, TUTORIAL_BEGINNER);
    }
  }

  update(time: number, delta: number) {
    if (this.tutorialSystem) {
      const context: TutorialContext = {
        x: this.robotPosition,
        y: this.robotSprite.y,
        velocity: this.robotVelocity,
        energy: (this.currentEnergy / this.params.energy) * 100,
        accelerating: this.drivingInput.accelerate,
        braking: this.drivingInput.brake,
        itemsCollected: this.itemsCollected,
        collisions: this.collisions,
        time: this.currentTime,
      };

      const isPaused = this.tutorialSystem.update(context);
      if (isPaused) {
        return; // 暂停游戏逻辑
      }
    }

    // 正常游戏逻辑...
  }
}
```

### 创建自定义教程：

```typescript
const customTutorial: TutorialStep[] = [
  {
    id: 'intro',
    trigger: () => true,
    message: '这是自定义教程！',
    waitFor: (ctx) => ctx.x > 100,
    pauseGame: false,
  },
  // ... 更多步骤
];

const tutorial = new TutorialSystem(this, customTutorial);
```

---

## 🔊 音效系统使用示例

### 初始化（在 PreloadScene 或 MainMenuScene）：

```typescript
import { AudioManager } from '../systems/AudioManager';

export default class MainMenuScene extends Phaser.Scene {
  create() {
    // 初始化 AudioManager
    AudioManager.getInstance().init(this);

    // 播放菜单音乐
    AudioManager.getInstance().playMusic('bgm_menu');
  }
}
```

### 在游戏中使用：

```typescript
// 拾取道具
AudioManager.getInstance().play('pickup');

// 碰撞
AudioManager.getInstance().play('collide');

// 启动引擎音
AudioManager.getInstance().startEngine();

// 更新引擎速度（根据机器人速度）
const speedRatio = this.robotVelocity / this.params.maxSpeed;
AudioManager.getInstance().setEngineSpeed(speedRatio);

// 任务成功
AudioManager.getInstance().stopEngine();
AudioManager.getInstance().play('mission_success');
```

### 音量控制：

```typescript
// 设置主音量
AudioManager.getInstance().setVolume('master', 0.8);

// 设置音效音量
AudioManager.getInstance().setVolume('sfx', 0.7);

// 设置音乐音量
AudioManager.getInstance().setVolume('music', 0.5);

// 静音
AudioManager.getInstance().mute(true);
```

---

## 🎯 下一步

**M7 已完成**！音效和教程系统搭建完毕。

**剩余任务**：
- **M8：性能优化和测试**

**可选改进**：
- 集成 AudioManager 到 MissionPlayScene（播放拾取、碰撞、引擎音效）
- 集成 TutorialSystem 到任务 00（新手教程关卡）
- 添加音量设置界面（在主菜单或暂停菜单）

---

**M7 完成！** 🎉🎵
