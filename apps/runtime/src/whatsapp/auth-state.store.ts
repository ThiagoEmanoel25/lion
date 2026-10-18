import { Inject,Injectable } from '@nestjs/common';
import { BufferJSON, initAuthCreds, proto, type AuthenticationState } from '@whiskeysockets/baileys';
import { loadConfig } from '../config.js';
import { FieldCipher } from '../crypto/field-cipher.js';
import { PrismaService } from '../infra/prisma.service.js';

@Injectable()
export class AuthStateStore {
  private readonly cipher = new FieldCipher(loadConfig().encryptionKey);
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private serialize(value: unknown) { return JSON.stringify(value, BufferJSON.replacer); }
  private deserialize<T>(value: string): T { return JSON.parse(value, BufferJSON.reviver) as T; }

  async load(channelId: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
    const stored = await this.prisma.whatsAppAuthState.findUnique({ where: { channelId } });
    const creds = stored
      ? this.deserialize<AuthenticationState['creds']>(this.cipher.decrypt(stored.encryptedCreds))
      : initAuthCreds();

    const keys: AuthenticationState['keys'] = {
      get: async (category, ids) => {
        const rows = await this.prisma.whatsAppAuthKey.findMany({
          where: { channelId, category, keyId: { in: ids } }
        });
        const result: Record<string, unknown> = {};
        for (const row of rows) {
          const value = this.deserialize(this.cipher.decrypt(row.encryptedValue));
          result[row.keyId] = category === 'app-state-sync-key' && value
            ? proto.Message.AppStateSyncKeyData.fromObject(value as object)
            : value;
        }
        return result as never;
      },
      set: async data => {
        const operations = Object.entries(data).flatMap(([category, values]) =>
          Object.entries(values ?? {}).map(([keyId, value]) => value == null
            ? this.prisma.whatsAppAuthKey.deleteMany({ where: { channelId, category, keyId } })
            : this.prisma.whatsAppAuthKey.upsert({
                where: { channelId_category_keyId: { channelId, category, keyId } },
                create: { channelId, category, keyId, encryptedValue: this.cipher.encrypt(this.serialize(value)) },
                update: { encryptedValue: this.cipher.encrypt(this.serialize(value)) }
              }))
        );
        if (operations.length) await this.prisma.$transaction(operations);
      }
    };

    const saveCreds = async () => {
      const encryptedCreds = this.cipher.encrypt(this.serialize(creds));
      await this.prisma.whatsAppAuthState.upsert({
        where: { channelId },
        create: { channelId, encryptedCreds },
        update: { encryptedCreds }
      });
    };
    return { state: { creds, keys }, saveCreds };
  }

  async clear(channelId: string) {
    await this.prisma.$transaction([
      this.prisma.whatsAppAuthKey.deleteMany({ where: { channelId } }),
      this.prisma.whatsAppAuthState.deleteMany({ where: { channelId } })
    ]);
  }
}
