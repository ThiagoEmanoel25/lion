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

export type OutboundJob = {messageId?:string;channelId?:string;typed?:boolean;notification?:{channelId:string;phone:string;text:string};reaction?:{channelId:string;phone:string;messageExternalId:string;emoji:string}};
export type { AutomationJob } from './automation/automation-engine.service.js';
