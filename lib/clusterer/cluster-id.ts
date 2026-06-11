import { randomUUID } from "node:crypto";

let currentFactory: (() => string) | null = null;

export function generateClusterId(): string {
  return currentFactory !== null ? currentFactory() : randomUUID();
}

export function __test__setClusterIdFactory(factory: (() => string) | null): void {
  currentFactory = factory;
}
