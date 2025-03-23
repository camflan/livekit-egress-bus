// Code generated by protoc-gen-ts_proto. DO NOT EDIT.
// versions:
//   protoc-gen-ts_proto  v2.6.1
//   protoc               v4.25.6

/* eslint-disable */
import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";

export interface MessageType<Message extends UnknownMessage = UnknownMessage> {
  $type: Message["$type"];
  encode(message: Message, writer?: BinaryWriter): BinaryWriter;
  decode(input: BinaryReader | Uint8Array, length?: number): Message;
  fromJSON(object: any): Message;
  toJSON(message: Message): unknown;
  fromPartial(object: DeepPartial<Message>): Message;
}

export type UnknownMessage = { $type: string };

export const messageTypeRegistry = new Map<string, MessageType>();

type Builtin = Date | Function | Uint8Array | string | number | boolean | bigint | undefined;
export type DeepPartial<T> = T extends Builtin ? T
  : T extends globalThis.Array<infer U> ? globalThis.Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U> ? ReadonlyArray<DeepPartial<U>>
  : T extends {} ? { [K in Exclude<keyof T, "$type">]?: DeepPartial<T[K]> }
  : Partial<T>;
