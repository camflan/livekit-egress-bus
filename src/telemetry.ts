import { TypedEventEmitter } from "./helpers/typed-event-emitter.js";

export type TelemetryEvent =
  | {
      type: "bus.message:received";
      channel: string;
      timestamp: number;
    }
  | {
      type: "bus.message:dispatched";
      channel: string;
      subscriberId: string;
      queue: boolean;
      timestamp: number;
    }
  | {
      type: "bus.subscriber:added";
      channel: string;
      subscriberId: string;
      queue: boolean;
      totalSubscribers: number;
      timestamp: number;
    }
  | {
      type: "bus.subscriber:removed";
      channel: string;
      subscriberId: string;
      queue: boolean;
      remainingSubscribers: number;
      timestamp: number;
    }
  | {
      type: "bus.queue:skip";
      channel: string;
      reason: string;
      timestamp: number;
    };

export class TelemetryCollector extends TypedEventEmitter<TelemetryEvent> {}

export const telemetry = new TelemetryCollector();
