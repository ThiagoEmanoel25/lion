import { describe, expect, it } from 'vitest';
import { outsideHoursSettings } from './outside-hours.js';

const days = [0, 1, 2, 3, 4, 5, 6].map(day => ({ day, enabled: false, open: '08:00', close: '18:00' }));
describe('outsideHoursSettings', () => {
  it('lê a configuração salva e usa o fuso do workspace quando o campo falta', () => {
    expect(outsideHoursSettings({ businessHours: { days, outsideMessage: ' Fechado ' } }, 'America/Bahia')).toMatchObject({ message: 'Fechado', timezone: 'America/Bahia' });
    expect(outsideHoursSettings({ businessHours: { days, outsideMessage: 'x', timezone: 'Europe/Lisbon' } }, 'America/Bahia')?.timezone).toBe('Europe/Lisbon');
  });
  it('sem configuração salva, sem mensagem ou sem dias: não envia nada', () => {
    expect(outsideHoursSettings(null, 'UTC')).toBeNull();
    expect(outsideHoursSettings({}, 'UTC')).toBeNull();
    expect(outsideHoursSettings({ businessHours: { days, outsideMessage: '   ' } }, 'UTC')).toBeNull();
    expect(outsideHoursSettings({ businessHours: { outsideMessage: 'x' } }, 'UTC')).toBeNull();
  });
});
