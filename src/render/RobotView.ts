import * as THREE from 'three';
import type { Configuration } from '../domain/config/validateConfiguration';
import { ModelKit } from './ModelKit';
import type { ChassisRig } from './ChassisAnimation';
import { TRACK_LENGTH, TRACK_RADIUS, TRACK_CENTER_Y, trackPose, UPPER_LEG, LOWER_LEG, WHEEL_RADIUS } from './Locomotion';
import { PREVIEW_ASSETS } from '../content/assets';
import { MODULES } from '../content/modules';

export function createRobotView(kit: ModelKit, configuration: Configuration): THREE.Group {
  const robot = new THREE.Group();
  robot.name = 'robot-view';
  robot.userData.moduleIds = { ...configuration };
  robot.userData.wheels = [];
  const rig: ChassisRig = { wheels: [], tracks: [], legs: [] };
  robot.userData.chassisRig = rig;
  const { paint, dark, steel, rubber, orange, cyan } = kit.materials;
  kit.housing(robot, 2.05, 0.42, 1.1, [0, 0.77, 0], dark);
  kit.housing(robot, 1.75, 0.38, 1.06, [-0.15, 1.02, 0], paint);
  kit.box(robot, [1.35, 0.1, 1.02], [-0.32, 1.26, 0], steel);
  for (const side of [-1, 1]) {
    kit.box(robot, [1.35, 0.04, 0.045], [-0.32, 1.33, side * 0.44], orange);
    kit.housing(robot, 0.56, 0.13, 0.075, [-0.5, 1.06, side * 0.555], dark);
    kit.box(robot, [0.44, 0.025, 0.035], [-0.5, 1.07, side * 0.6], cyan);
    kit.housing(robot, 0.48, 0.21, 0.025, [0.35, 1.01, side * 0.54], dark);
    for (let index = 0; index < 5; index++) kit.box(robot, [0.035, 0.14, 0.025],
      [0.2 + index * 0.075, 1.01, side * 0.565], steel, [0, 0, -0.2]);
    kit.beam(robot, [-0.95, 0.65, side * 0.57], [0.93, 0.65, side * 0.57], 0.07, rubber);
    for (const xM of [-0.78, -0.4, 0, 0.4]) kit.cylinder(robot, 0.034, 0.025, [xM, 1.3, side * 0.4], dark, [Math.PI / 2, 0, 0], 8);
  }
  kit.housing(robot, 0.22, 0.18, 1.2, [1.05, 0.65, 0], steel);
  kit.housing(robot, 0.16, 0.09, 0.24, [1.13, 0.87, -0.34], cyan);
  kit.housing(robot, 0.16, 0.09, 0.24, [1.13, 0.87, 0.34], cyan);
  kit.label(robot, 'RL / 01', 0.42, 0.105, [-0.48, 0.87, 0.559], '#d9eff1', '#203445');
  kit.housing(robot, 0.13, 0.14, 1.05, [-1.04, 0.68, 0], rubber);
  for (const side of [-1, 1]) {
    kit.cylinder(robot, 0.055, 0.035, [-0.94, 1.22, side * 0.42], orange);
    kit.housing(robot, 0.08, 0.055, 0.18, [-1.06, 0.88, side * 0.35], orange);
  }

  const chassis = new THREE.Group();
  chassis.name = configuration.chassis ?? 'chassis:empty';
  robot.add(chassis);
  if (configuration.chassis === 'chassis_track') {
    for (const side of [-1, 1]) {
      kit.housing(chassis, 1.75, 0.24, 0.22, [0, TRACK_CENTER_Y, side * 0.7], dark);
      for (const xM of [-0.85, -0.42, 0, 0.42, 0.85]) {
        const radius = Math.abs(xM) === 0.85 ? TRACK_RADIUS - 0.04 : 0.25;
        const roller = new THREE.Group();
        roller.position.set(xM, TRACK_CENTER_Y, side * 0.7);
        chassis.add(roller);
        rig.wheels.push({ object: roller, radius: Math.abs(xM) === 0.85 ? TRACK_RADIUS : radius });
        kit.cylinder(roller, radius, 0.30, [0, 0, 0], steel, [Math.PI / 2, 0, 0]);
        kit.cylinder(roller, 0.09, 0.34, [0, 0, 0], dark, [Math.PI / 2, 0, 0]);
        for (let spoke = 0; spoke < 5; spoke++) {
          const angle = spoke * Math.PI * 2 / 5;
          kit.box(roller, [0.06, radius * 0.65, 0.025], [Math.sin(angle) * radius * 0.55, Math.cos(angle) * radius * 0.55, side * 0.165], orange, [0, 0, -angle]);
        }
      }
      for (let index = 0; index < 42; index++) {
        const offset = index / 42 * TRACK_LENGTH;
        const pose = trackPose(offset);
        const link = kit.box(chassis, [TRACK_LENGTH / 42 * 0.94, 0.08, 0.38], [pose.x, pose.y, side * 0.7], index % 7 === 0 ? steel : rubber, [0, 0, pose.angle]);
        rig.tracks.push({ object: link, offset });
      }
    }
  } else if (configuration.chassis === 'chassis_quadruped') {
    for (const side of [-1, 1]) for (const direction of [-1, 1]) {
      const hip: [number, number, number] = [direction * 0.68, 0.7, side * 0.49];
      kit.cylinder(chassis, 0.14, 0.2, hip, dark, [Math.PI / 2, 0, 0]);
      const upper = kit.housing(chassis, 0.15, UPPER_LEG, 0.20, hip, orange);
      const lower = kit.housing(chassis, 0.10, LOWER_LEG, 0.15, hip, steel);
      const joint = kit.cylinder(chassis, 0.12, 0.2, hip, dark, [Math.PI / 2, 0, 0]);
      const foot = kit.housing(chassis, 0.34, 0.16, 0.30, [direction * 0.68, 0.08, side * 1.03], rubber);
      // Hind-left, front-left, hind-right, front-right: one foot swings at a time.
      const offset = side < 0 ? (direction < 0 ? 0 : 0.25) : (direction < 0 ? 0.5 : 0.75);
      rig.legs.push({ hip, side, direction, offset, upper, lower, joint, foot });
    }
  } else if (configuration.chassis === 'chassis_wheel') {
    for (const side of [-1, 1]) for (const direction of [-1, 1]) {
      const center: [number, number, number] = [direction * 0.7, WHEEL_RADIUS, side * 0.66];
      kit.beam(chassis, [direction * 0.4, 0.71, side * 0.34], center, 0.09, steel);
      kit.strut(chassis, [direction * 0.45, 0.72, side * 0.5], [direction * 0.69, 0.41, side * 0.5], 0.045, orange);
      const wheel = new THREE.Group();
      wheel.position.set(...center);
      wheel.name = `wheel:${direction}:${side}`;
      chassis.add(wheel);
      robot.userData.wheels.push(wheel);
      rig.wheels.push({ object: wheel, radius: WHEEL_RADIUS });
      kit.cylinder(wheel, 0.355, 0.25, [0, 0, 0], rubber, [Math.PI / 2, 0, 0], 48);
      for (const edge of [-1, 1]) {
        kit.ring(wheel, 0.294, 0.074, [0, 0, edge * 0.085], rubber).rotation.x = 0;
        kit.ring(wheel, 0.218, 0.016, [0, 0, edge * 0.148], steel).rotation.x = 0;
      }
      kit.cylinder(wheel, 0.213, 0.27, [0, 0, 0], steel, [Math.PI / 2, 0, 0]);
      kit.cylinder(wheel, 0.178, 0.28, [0, 0, 0], dark, [Math.PI / 2, 0, 0]);
      for (let spoke = 0; spoke < 6; spoke++) {
        const angle = spoke * Math.PI / 3;
        const spokeMesh = kit.housing(wheel, 0.055, 0.17, 0.025,
          [Math.sin(angle) * 0.11, Math.cos(angle) * 0.11, side * 0.154], steel);
        spokeMesh.rotation.z = -angle;
        kit.cylinder(wheel, 0.016, 0.025, [Math.sin(angle) * 0.092, Math.cos(angle) * 0.092, side * 0.177],
          orange, [Math.PI / 2, 0, 0], 6);
      }
      kit.cylinder(wheel, 0.068, 0.35, [0, 0, 0], steel, [Math.PI / 2, 0, 0]);
      kit.cylinder(wheel, 0.033, 0.36, [0, 0, 0], dark, [Math.PI / 2, 0, 0], 6);
      for (let index = 0; index < 18; index++) {
        const angle = index * Math.PI / 9;
        kit.box(wheel, [0.065, 0.025, 0.21], [Math.sin(angle) * 0.367,
          Math.cos(angle) * 0.367, 0], dark, [0, 0, -angle]);
      }
      kit.housing(chassis, 0.85, 0.1, 0.35, [direction * 0.7, 0.85, side * 0.67], paint);
    }
  }

  const battery = new THREE.Group();
  battery.name = configuration.battery ?? 'battery:empty';
  robot.add(battery);
  if (configuration.battery) {
    const batteryLength = configuration.battery === 'battery_large' ? 0.82 : configuration.battery === 'battery_standard' ? 0.65 : 0.48;
    kit.housing(battery, batteryLength, 0.34, 0.7, [-0.57, 1.49, 0], dark);
    kit.housing(battery, batteryLength * 0.8, 0.23, 0.035, [-0.57, 1.49, 0.375], paint);
    for (let index = 0; index < 4; index++) kit.box(battery, [0.06, 0.085, 0.025], [-0.75 + index * 0.11, 1.5, 0.4], cyan);
    kit.beam(battery, [-0.8, 1.71, 0], [-0.35, 1.71, 0], 0.06, steel);
  }
  const motor = new THREE.Group();
  motor.name = configuration.motor ?? 'motor:empty';
  motor.position.set(0, 0.72, 0.67);
  robot.add(motor);
  if (configuration.motor) {
    const radius = configuration.motor === 'motor_high' ? 0.23 : configuration.motor === 'motor_standard' ? 0.19 : 0.15;
    kit.cylinder(motor, radius, 0.5, [-0.28, 0.7, 0], steel, [0, 0, Math.PI / 2]);
    for (let index = 0; index < 5; index++) kit.cylinder(motor, radius + 0.035, 0.035,
      [-0.49 + index * 0.1, 0.7, 0], dark, [0, 0, Math.PI / 2]);
    kit.box(motor, [0.15, 0.13, 0.25], [-0.3, 0.85, 0], orange);
  }

  const sensor = new THREE.Group();
  sensor.name = configuration.sensor ?? 'sensor:empty';
  robot.add(sensor);
  if (configuration.sensor) {
    kit.cylinder(sensor, 0.07, 0.43, [-0.83, 1.81, -0.26], steel);
    if (configuration.sensor === 'sensor_lidar') {
      kit.cylinder(sensor, 0.18, 0.18, [-0.83, 2.07, -0.26], dark);
      kit.cylinder(sensor, 0.185, 0.035, [-0.83, 2.08, -0.26], cyan);
    } else {
      kit.housing(sensor, 0.22, 0.18, configuration.sensor === 'sensor_depth' ? 0.44 : 0.26, [-0.83, 2.04, -0.26], paint);
      for (const offset of configuration.sensor === 'sensor_depth' ? [-0.12, 0.12] : [0]) {
        kit.cylinder(sensor, 0.065, 0.03, [-0.69, 2.04, -0.26 + offset], dark, [0, 0, Math.PI / 2]);
        kit.cylinder(sensor, 0.035, 0.035, [-0.67, 2.04, -0.26 + offset], cyan, [0, 0, Math.PI / 2]);
      }
    }
  }

  const tool = new THREE.Group();
  tool.name = configuration.tool ?? 'tool:empty';
  robot.add(tool);
  if (configuration.tool === 'tool_arm') {
    kit.cylinder(tool, 0.29, 0.16, [0.5, 1.33, 0], dark);
    kit.cylinder(tool, 0.24, 0.13, [0.5, 1.45, 0], orange);
    const joints: [number, number, number][] = [[0.5, 1.51, 0], [0.18, 2.27, 0], [0.93, 2.55, 0], [1.28, 2.23, 0]];
    for (let index = 0; index < joints.length - 1; index++) {
      kit.beam(tool, joints[index], joints[index + 1], index === 0 ? 0.22 : 0.17, orange, 0.29);
      for (const side of [-1, 1]) {
        const start = joints[index];
        const end = joints[index + 1];
        kit.beam(tool, [start[0], start[1], side * 0.155], [end[0], end[1], side * 0.155], 0.075, paint, 0.025);
        kit.ring(tool, 0.12 - index * 0.02, 0.016, [end[0], end[1], side * 0.19], dark).rotation.x = 0;
      }
      kit.cylinder(tool, 0.145 - index * 0.02, 0.34, joints[index + 1], steel, [Math.PI / 2, 0, 0]);
      kit.cylinder(tool, 0.065, 0.37, joints[index + 1], dark, [Math.PI / 2, 0, 0]);
    }
    kit.strut(tool, [0.68, 1.58, 0.22], [0.51, 1.94, 0.22], 0.055, dark);
    kit.strut(tool, [0.51, 1.94, 0.22], [0.4, 2.16, 0.22], 0.028, steel);
    kit.strut(tool, [0.36, 2.1, 0.22], [0.85, 2.44, 0.22], 0.028, steel);
    kit.cable(tool, [[0.37, 1.45, -0.2], [-0.03, 1.78, -0.23], [0.02, 2.35, -0.23],
      [0.53, 2.74, -0.23], [0.94, 2.63, -0.2], [1.3, 2.22, -0.2]], 0.034, rubber);
    kit.housing(tool, 0.24, 0.25, 0.34, [1.3, 2.16, 0], dark);
    for (const side of [-1, 1]) {
      kit.beam(tool, [1.3, 2.1, side * 0.15], [1.38, 1.88, side * 0.25], 0.065, steel);
      kit.beam(tool, [1.38, 1.88, side * 0.25], [1.52, 1.78, side * 0.12], 0.065, steel);
    }
  } else if (configuration.tool === 'tool_gripper') {
    kit.housing(tool, 0.45, 0.25, 0.6, [0.65, 1.4, 0], dark);
    kit.beam(tool, [0.65, 1.5, 0], [1.24, 1.52, 0], 0.17, paint, 0.3);
    kit.cylinder(tool, 0.15, 0.62, [1.24, 1.48, 0], steel, [Math.PI / 2, 0, 0]);
    for (const side of [-1, 1]) {
      kit.housing(tool, 0.6, 0.15, 0.13, [1.52, 1.47, side * 0.28], orange);
      kit.box(tool, [0.11, 0.18, 0.18], [1.8, 1.43, side * 0.21], rubber);
      kit.box(tool, [0.35, 0.035, 0.035], [1.5, 1.57, side * 0.29], cyan);
    }
  } else if (configuration.tool === 'tool_blade') {
    for (const side of [-1, 1]) kit.beam(tool, [0.65, 0.6, side * 0.4], [1.5, 0.38, side * 0.4], 0.11, steel);
    kit.housing(tool, 0.22, 0.68, 1.7, [1.55, 0.4, 0], orange);
    kit.box(tool, [0.25, 0.09, 1.78], [1.6, 0.08, 0], steel);
  }
  const accessory = new THREE.Group();
  accessory.name = configuration.accessory ?? 'accessory:empty';
  robot.add(accessory);
  if (configuration.accessory === 'tool_blade') {
    for (const side of [-1, 1]) kit.beam(accessory, [.65,.6,side*.4], [1.5,.38,side*.4], .11, steel);
    kit.housing(accessory, .22, .68, 1.7, [1.55,.4,0], orange);
    kit.box(accessory, [.25,.09,1.78], [1.6,.08,0], steel);
  }
  for (const component of [chassis, motor, battery, sensor, tool, accessory]) {
    if (component.name.includes(':empty')) continue;
    const assetId = MODULES.find(module => module.id === component.name)?.viewAssetId;
    if (!PREVIEW_ASSETS.some(asset => asset.id === assetId && asset.status === 'procedural-preview')) throw new Error(`未登记的机器人资产：${assetId}`);
    component.userData.assetId = assetId;
  }
  return robot;
}

