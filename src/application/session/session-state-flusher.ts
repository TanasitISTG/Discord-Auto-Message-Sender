export class SessionStateFlusher {
    private stateFlushTimer: NodeJS.Timeout | null = null;
    private stateFlushPending = false;
    private stateFlushInFlight: Promise<void> | null = null;

    constructor(
        private readonly debounceMs: number,
        private readonly flush: () => void | Promise<void>,
    ) {}

    schedule() {
        this.stateFlushPending = true;
        if (this.stateFlushTimer) {
            return;
        }

        this.stateFlushTimer = setTimeout(() => {
            this.stateFlushTimer = null;
            void this.flushNow();
        }, this.debounceMs);
    }

    clearTimer() {
        if (this.stateFlushTimer) {
            clearTimeout(this.stateFlushTimer);
            this.stateFlushTimer = null;
        }
    }

    async flushNow() {
        while (true) {
            if (this.stateFlushInFlight) {
                await this.stateFlushInFlight;
                return;
            }

            if (!this.stateFlushPending) {
                return;
            }

            this.stateFlushPending = false;
            this.stateFlushInFlight = Promise.resolve(this.flush());

            try {
                await this.stateFlushInFlight;
            } finally {
                this.stateFlushInFlight = null;
            }

            if (!this.stateFlushPending) {
                return;
            }
        }
    }
}
