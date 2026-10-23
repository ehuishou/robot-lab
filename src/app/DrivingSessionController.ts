import { findNearbyInteraction } from '../domain/mission/nearbyInteraction';
import { transitionSession } from '../domain/mission/session';
import type { DomainEvent, SessionCommand, SessionState } from '../domain/mission/session';
import { DRIVING_STEP_SECONDS } from '../domain/simulation/driving';
import { DrivingInput } from '../input/DrivingInput';
import { FixedStepClock } from './FixedStepClock';

export class DrivingSessionController {
  readonly input = new DrivingInput();
  private readonly clock = new FixedStepClock();
  private current: SessionState;
  private commandSequence: number;

  constructor(state: SessionState) {
    this.current = state;
    this.commandSequence = state.processedCommandIds.length;
    this.input.setEnabled(state.phase === 'running');
  }

  get state(): SessionState {
    return this.current;
  }

  pause(): readonly DomainEvent[] {
    this.input.setEnabled(false);
    this.clock.reset();
    return this.current.phase === 'running' ? this.apply({ kind: 'pause' }) : [];
  }

  resume(): readonly DomainEvent[] {
    if (this.current.phase !== 'paused') return [];
    const events = this.apply({ kind: 'resume' });
    this.input.setEnabled(true);
    this.clock.reset();
    return events;
  }

  advanceFrame(timestampMs: number): Readonly<{ steps: number; discardedSeconds: number; events: readonly DomainEvent[] }> {
    const frame = this.clock.advance(timestampMs, this.current.phase === 'running');
    const events: DomainEvent[] = [];
    let steps = 0;
    for (; steps < frame.steps && this.current.phase === 'running'; steps++) {
      const intent = this.input.poll();
      const interaction = intent.interact ? findNearbyInteraction(this.current) : null;
      if (interaction?.kind === 'work' || interaction?.kind === 'stage') this.action(interaction);
      events.push(...this.apply({ kind: 'drive', deltaSeconds: DRIVING_STEP_SECONDS, intent,
        interactions: interaction?.kind === 'pickup' || interaction?.kind === 'deliver' ? [interaction] : [] }));
    }
    if (this.current.phase !== 'running') {
      this.input.setEnabled(false);
      this.clock.reset();
    }
    return Object.freeze({ steps, discardedSeconds: frame.discardedSeconds, events: Object.freeze(events) });
  }

  physicsTest(action: 'push' | 'topple' | 'reset'): void {
    if (this.current.phase !== 'running' || !this.current.mission.testMode || !this.current.quadruped) return;
    this.apply({ kind: 'physicsTest', action });
    if (action === 'reset') this.input.clear();
  }

  action(command: {kind:'route';sectionId:string;route:'direct'|'bypass'} | {kind:'work'} | {kind:'stage';cargoIds:readonly string[]} | {kind:'assist';enabled:boolean}): boolean {
    const result=transitionSession(this.current,{...command,sessionId:this.current.sessionId,commandId:this.current.sessionId+':action:'+(++this.commandSequence)});
    if (!result.accepted) return false;
    this.current=result.state;return true;
  }

  private apply(command: Omit<Extract<SessionCommand, { kind: 'drive' }>, 'sessionId' | 'commandId'> | { kind: 'pause' | 'resume' } | { kind: 'physicsTest'; action: 'push' | 'topple' | 'reset' }): readonly DomainEvent[] {
    const result = transitionSession(this.current, { ...command, sessionId: this.current.sessionId,
      commandId: `${this.current.sessionId}:controller:${++this.commandSequence}` });
    if (!result.accepted) throw new Error(`驾驶控制器指令被拒绝：${result.reason}`);
    this.current = result.state;
    return result.events;
  }
}
