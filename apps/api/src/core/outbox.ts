import type { Prisma, PrismaClient } from '@prisma/client';
export function enqueue(tx:Prisma.TransactionClient|PrismaClient,event:{workspaceId:string;aggregate:string;aggregateId:string;type:string;payload:Prisma.InputJsonValue;availableAt?:Date}){return tx.outboxEvent.create({data:event})}
