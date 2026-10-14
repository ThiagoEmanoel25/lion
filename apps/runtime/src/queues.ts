export const QUEUES = {
  whatsappConnection: 'whatsapp.connection',
  whatsappOutbound: 'whatsapp.outbound',
  automationExecute: 'automation.execute'
} as const;

export type ConnectionJob = {
  channelId: string;
  action: 'connect' | 'reconnect' | 'disconnect';
  pairingPhoneNumber?: string;
  removeAuth?: boolean;
};

export type OutboundJob = { messageId: string; channelId?: string };
export type { AutomationJob } from './automation/automation-engine.service.js';
