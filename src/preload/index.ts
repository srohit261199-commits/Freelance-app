import { contextBridge, ipcRenderer } from 'electron';
import { HUB_METHODS, type Hub } from '../shared/api';
import type { AppState } from '../shared/types';

const hub = Object.fromEntries(HUB_METHODS.map(name => [name, (...args: unknown[]) => ipcRenderer.invoke(`hub:${name}`, ...args)])) as unknown as Hub;

hub.onState = (listener: (s: AppState) => void) => {
  const handler = (_e: unknown, s: AppState) => listener(s);
  ipcRenderer.on('hub:state', handler);
  return () => ipcRenderer.removeListener('hub:state', handler);
};

contextBridge.exposeInMainWorld('hub', hub);
