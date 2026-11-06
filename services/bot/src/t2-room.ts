/** T2 twin room wired to the frozen meeting connector (services/bot/src/meeting/connector.ts). */
import { createMeetingConnector } from "./meeting/connector.js";
import {
  createTwinRoom as createCoreTwinRoom,
  runDemoEndToEnd as runCoreDemoEndToEnd,
  type DemoEndToEndOptions,
  type TwinRoomOptions,
} from "@second-seat/core";
export * from "@second-seat/core";
export const T2_CONNECTOR_FACTORY = createMeetingConnector;
export function createTwinRoom(opts?: Omit<TwinRoomOptions, "connector">) {
  return createCoreTwinRoom({ ...opts, connector: T2_CONNECTOR_FACTORY });
}
export function runDemoEndToEnd(opts?: Omit<DemoEndToEndOptions, "connector">) {
  return runCoreDemoEndToEnd({ ...opts, connector: T2_CONNECTOR_FACTORY });
}
