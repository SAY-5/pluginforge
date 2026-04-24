// RPC protocol shared by host and plugin side of the sandbox.

export type ReqId = number;

export interface ReqMsg {
  kind: "req";
  id: ReqId;
  method: string;
  args: unknown[];
}

export interface ResMsgOk {
  kind: "res";
  id: ReqId;
  ok: true;
  value: unknown;
}

export interface ResMsgErr {
  kind: "res";
  id: ReqId;
  ok: false;
  error: { code: string; message: string };
}

export type ResMsg = ResMsgOk | ResMsgErr;

export interface EvtMsg {
  kind: "evt";
  topic: string;
  data: unknown;
}

export interface CancelMsg {
  kind: "cancel";
  id: ReqId;
}

export interface ReadyMsg {
  kind: "ready";
}

export interface LoadBundleMsg {
  kind: "loadBundle";
  source: string;
  pluginId: string;
  grants: string[]; // Encoded capability descriptors.
}

export interface LogMsg {
  kind: "log";
  level: "debug" | "info" | "warn" | "error";
  args: unknown[];
}

export interface HeartbeatMsg {
  kind: "hb";
  token: number;
}

export type PluginInboundMsg =
  | LoadBundleMsg
  | ReqMsg
  | ResMsg
  | EvtMsg
  | CancelMsg
  | HeartbeatMsg;

export type PluginOutboundMsg =
  | ReadyMsg
  | ReqMsg
  | ResMsg
  | EvtMsg
  | CancelMsg
  | LogMsg
  | HeartbeatMsg;

// Error codes surfaced through the RPC layer.
export const ErrorCodes = {
  PermissionDenied: "PermissionDenied",
  MethodNotFound: "MethodNotFound",
  InvalidArgs: "InvalidArgs",
  Cancelled: "Cancelled",
  PluginCrashed: "PluginCrashed",
  Timeout: "Timeout",
  Internal: "Internal",
} as const;
