import type { ModuleDefinition } from '../domain/config/validateConfiguration';

export interface CatalogModule extends ModuleDefinition {
  readonly name: string;
  readonly description: string;
}

/** Shared by assembly UI, validation, simulation and procedural assets. */
export const MODULES: readonly CatalogModule[] = [
  {
    "id": "chassis_wheel",
    "viewAssetId": "module:chassis_wheel",
    "category": "chassis",
    "massKg": 15,
    "cost": 70,
    "capabilities": [],
    "driving": {
      "maxSpeedMps": 5,
      "accelerationMps2": 3,
      "driveDrainUnitsPerSecond": 0.3
    },
    "name": "轮式底盘",
    "description": "平地速度快；沙地减速明显，拱桥需要绕行"
  },
  {
    "id": "chassis_track",
    "viewAssetId": "module:chassis_track",
    "category": "chassis",
    "massKg": 25,
    "cost": 100,
    "capabilities": [],
    "driving": {
      "maxSpeedMps": 3.8,
      "accelerationMps2": 2.8,
      "driveDrainUnitsPerSecond": 0.4
    },
    "name": "履带底盘",
    "description": "沙地减速最小；拱桥需要绕行，平地速度较低"
  },
  {
    "id": "chassis_quadruped",
    "viewAssetId": "module:chassis_quadruped",
    "category": "chassis",
    "massKg": 30,
    "cost": 150,
    "capabilities": [],
    "driving": {
      "maxSpeedMps": 3.2,
      "accelerationMps2": 2.6,
      "driveDrainUnitsPerSecond": 0.5
    },
    "name": "四足底盘",
    "description": "唯一可直行翻越拱桥的底盘；沙地仍会减速"
  },
  {
    "id": "motor_low",
    "viewAssetId": "module:motor_low",
    "category": "motor",
    "massKg": 5,
    "cost": 35,
    "capabilities": [],
    "driving": {
      "maxSpeedMps": 4,
      "accelerationMps2": 2.8,
      "driveDrainUnitsPerSecond": 0.35
    },
    "name": "低功耗电机",
    "description": "速度低，效率高，重量轻"
  },
  {
    "id": "motor_standard",
    "viewAssetId": "module:motor_standard",
    "category": "motor",
    "massKg": 8,
    "cost": 60,
    "capabilities": [],
    "driving": {
      "maxSpeedMps": 5.5,
      "accelerationMps2": 3.6,
      "driveDrainUnitsPerSecond": 0.5
    },
    "name": "标准电机",
    "description": "速度中，效率中，重量中"
  },
  {
    "id": "motor_high",
    "viewAssetId": "module:motor_high",
    "category": "motor",
    "massKg": 12,
    "cost": 100,
    "capabilities": [],
    "driving": {
      "maxSpeedMps": 7,
      "accelerationMps2": 4.5,
      "driveDrainUnitsPerSecond": 0.8
    },
    "name": "高性能电机",
    "description": "速度高，效率低，重量高"
  },
  {
    "id": "sensor_camera",
    "viewAssetId": "module:sensor_camera",
    "category": "sensor",
    "massKg": 2,
    "cost": 20,
    "capabilities": [],
    "name": "摄像头",
    "description": "成本低，基础感知能力"
  },
  {
    "id": "sensor_depth",
    "viewAssetId": "module:sensor_depth",
    "category": "sensor",
    "massKg": 4,
    "cost": 40,
    "capabilities": [],
    "name": "深度摄像头",
    "description": "感知更强，重量和能耗增加"
  },
  {
    "id": "sensor_lidar",
    "viewAssetId": "module:sensor_lidar",
    "category": "sensor",
    "massKg": 6,
    "cost": 70,
    "capabilities": [],
    "name": "LiDAR",
    "description": "感知能力强，成本、重量和能耗较高"
  },
  {
    "id": "battery_small",
    "viewAssetId": "module:battery_small",
    "category": "battery",
    "massKg": 8,
    "cost": 40,
    "capabilities": [],
    "batteryCapacityUnits": 32,
    "name": "小电池",
    "description": "轻，容量低，成本低"
  },
  {
    "id": "battery_standard",
    "viewAssetId": "module:battery_standard",
    "category": "battery",
    "massKg": 15,
    "cost": 70,
    "capabilities": [],
    "batteryCapacityUnits": 70,
    "name": "标准电池",
    "description": "综合平衡"
  },
  {
    "id": "battery_large",
    "viewAssetId": "module:battery_large",
    "category": "battery",
    "massKg": 25,
    "cost": 110,
    "capabilities": [],
    "batteryCapacityUnits": 100,
    "name": "大电池",
    "description": "容量高，重量高，成本高"
  },
  {
    "id": "tool_arm",
    "viewAssetId": "module:tool_arm",
    "category": "tool",
    "massKg": 10,
    "cost": 70,
    "capabilities": [
      "carryLight",
      "carryHeavy"
    ],
    "payload": {
      "kind": "limit",
      "massKg": 25
    },
    "name": "机械臂",
    "description": "搬运、抓取物体"
  },
  {
    "id": "tool_blade",
    "viewAssetId": "module:tool_blade",
    "category": "accessory",
    "massKg": 15,
    "cost": 40,
    "capabilities": [
      "clearCrate",
      "clearDebris"
    ],
    "name": "推土铲",
    "description": "快速推开碎料箱，清障用时减半"
  },
  {
    "id": "tool_gripper",
    "viewAssetId": "module:tool_gripper",
    "category": "tool",
    "massKg": 6,
    "cost": 45,
    "capabilities": [
      "carryLight",
      "carryPart"
    ],
    "payload": {
      "kind": "limit",
      "massKg": 18
    },
    "name": "抓取器",
    "description": "抓取指定目标"
  }
];
