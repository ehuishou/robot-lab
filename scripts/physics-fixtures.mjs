import {load} from './verification-loader.mjs';
const {TRANSPORT_MISSION}=load('src/content/challenges.ts');
export const PHYSICS_MISSIONS = [
  { ...TRANSPORT_MISSION, id:'physics-flat', environment:undefined, challenge:undefined },
  { ...TRANSPORT_MISSION, id:'physics-incline', environment:undefined, challenge:undefined,
    platforms:TRANSPORT_MISSION.platforms.map(p=>p.id==='loading'?{...p,startM:45,endM:55}:p),
    layout:TRANSPORT_MISSION.layout.map(i=>i.kind==='cargo'?{...i,xM:50}:i),
    terrain:{id:'physics-incline',maxSlopeDegrees:8,maxCurvaturePerM:.04,points:[{xM:0,heightM:0},{xM:20,heightM:0},{xM:40,heightM:1.2},{xM:60,heightM:1.2},{xM:80,heightM:0},{xM:100,heightM:0}]}}
];
