import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { HTML_MESSAGE_OPTIONS, createTelegramNotifier } from './notifier';

function setup(failSendFor: number[] = []) {
  let nextId = 100;
  const sendMessage = vi.fn((chatId: number | string) =>
    failSendFor.includes(Number(chatId))
      ? Promise.reject(new Error('blocked'))
      : Promise.resolve({ message_id: nextId++ }),
  );
  const editMessageText = vi.fn(() => Promise.resolve(true));
  const notifier = createTelegramNotifier({
    api: { sendMessage, editMessageText } as never,
    chatIds: [111, 222],
    logger: pino({ level: 'silent' }),
  });
  return { notifier, sendMessage, editMessageText };
}

describe('createTelegramNotifier', () => {
  it('returns the message id sent to each chat, skipping chats that failed', async () => {
    const ok = setup();
    expect(await ok.notifier.send('<b>x</b>')).toEqual([
      { chatId: 111, messageId: 100 },
      { chatId: 222, messageId: 101 },
    ]);
    expect(ok.sendMessage).toHaveBeenCalledWith(111, '<b>x</b>', HTML_MESSAGE_OPTIONS);

    const partial = setup([111]);
    expect(await partial.notifier.send('x')).toEqual([{ chatId: 222, messageId: 100 }]);
  });

  it('edits sent messages with the HTML options', async () => {
    const { notifier, editMessageText } = setup();
    const sent = await notifier.send('alert');
    await notifier.edit(sent, 'alert\n🧪 Paper: diikuti');
    expect(editMessageText).toHaveBeenCalledTimes(2);
    expect(editMessageText).toHaveBeenCalledWith(
      111,
      100,
      'alert\n🧪 Paper: diikuti',
      HTML_MESSAGE_OPTIONS,
    );
  });

  it('does not throw when an edit fails', async () => {
    const { notifier, editMessageText } = setup();
    editMessageText.mockRejectedValue(new Error('message to edit not found'));
    await expect(notifier.edit([{ chatId: 111, messageId: 1 }], 'x')).resolves.toBeUndefined();
  });

  it('can leave out the chat that triggered a notification', async () => {
    const { notifier, sendMessage } = setup();
    notifier.notify('⏸ dijeda', { excludeChatId: 111 });
    await notifier.flush();
    expect(sendMessage.mock.calls.map((call) => call[0])).toEqual([222]);
  });
});
