export function pickNextMessage(
    messages: string[],
    sentCache: Set<string>,
    random: () => number = Math.random,
    recentHistory: string[] = []
): string {
    if (messages.length === 0) {
        throw new Error('Cannot pick a message from an empty group.');
    }

    const uniqueMessageCount = new Set(messages).size;

    if (sentCache.size >= uniqueMessageCount) {
        sentCache.clear();
    }

    let availableMessages = messages.filter((message) => !sentCache.has(message));
    const recentSet = new Set(recentHistory);
    const nonRecentMessages = availableMessages.filter((message) => !recentSet.has(message));
    if (nonRecentMessages.length > 0) {
        availableMessages = nonRecentMessages;
    }

    if (availableMessages.length === 0) {
        sentCache.clear();
        const resetMessages = [...messages];
        const message = resetMessages[Math.floor(random() * resetMessages.length)];
        sentCache.add(message);
        return message;
    }

    const message = availableMessages[Math.floor(random() * availableMessages.length)];
    sentCache.add(message);
    return message;
}
